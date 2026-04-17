#!/usr/bin/env node
// Frees the configured PORT (default 8080) by finding any process holding it
// (via /proc/net/tcp) and sending SIGKILL. Safe: only targets the actual
// listener PID, never the parent shell.
import fs from "node:fs";
import net from "node:net";

const PORT = Number(process.env.PORT || 8080);
const portHex = PORT.toString(16).toUpperCase().padStart(4, "0");

function findInodes() {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n").slice(1);
      for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10) continue;
        const localAddr = cols[1] || "";
        const state = cols[3];
        if (state !== "0A") continue; // 0A = LISTEN
        const localPort = localAddr.split(":")[1];
        if (localPort === portHex) inodes.add(cols[9]);
      }
    } catch { /* ignore */ }
  }
  return inodes;
}

// Only kill processes that look like our own server entrypoint, never random
// processes that happened to bind the port.
const EXPECTED_CMDLINE_MARKER = "dist/index.mjs";

function pidLooksLikeOurServer(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const cmdline = raw.replace(/\0/g, " ");
    return cmdline.includes(EXPECTED_CMDLINE_MARKER);
  } catch {
    return false;
  }
}

function findPidsForInodes(inodes) {
  const pids = new Set();
  if (inodes.size === 0) return pids;
  let entries;
  try { entries = fs.readdirSync("/proc"); } catch { return pids; }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;
    const pidNum = Number(pid);
    if (pidNum === process.pid || pidNum === process.ppid) continue;
    let fdDir;
    try { fdDir = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fdDir) {
      let target;
      try { target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const m = target.match(/^socket:\[(\d+)\]$/);
      if (m && inodes.has(m[1])) {
        pids.add(pidNum);
        break;
      }
    }
  }
  return pids;
}

async function isPortFree() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(PORT, "0.0.0.0");
  });
}

async function main() {
  if (await isPortFree()) {
    return;
  }
  const inodes = findInodes();
  const pids = findPidsForInodes(inodes);
  const targets = [...pids].filter(pidLooksLikeOurServer);
  if (targets.length === 0) {
    if (pids.size > 0) {
      console.log(`free-port: :${PORT} held by foreign process(es) [${[...pids].join(",")}] — leaving alone`);
    }
    return;
  }
  for (const pid of targets) {
    try { process.kill(pid, "SIGTERM"); } catch { /* may already be gone */ }
  }
  // Brief grace period for SIGTERM, then SIGKILL any survivors
  await new Promise(r => setTimeout(r, 400));
  for (const pid of targets) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
      console.log(`free-port: SIGKILLed pid ${pid} holding :${PORT}`);
    } catch {
      console.log(`free-port: pid ${pid} exited cleanly after SIGTERM`);
    }
  }
  // Wait briefly for the kernel to release the port
  await new Promise(r => setTimeout(r, 400));
}

main().catch(() => { /* never block startup */ });

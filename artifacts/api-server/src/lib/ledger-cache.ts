/**
 * Shared in-memory ledger cache.
 *
 * Dhan ledger API has strict rate limits (DH-904). Caching responses avoids
 * hammering it from multiple simultaneous endpoints.
 *
 *  - Short ranges (≤90d): 3-minute TTL
 *  - Long/all-time ranges (>90d): 15-minute TTL
 *
 * Call `clearLedgerCache()` on broker disconnect so stale data from a previous
 * account never bleeds into a newly connected session.
 */

import { dhanClient } from "./dhan-client";

const LEDGER_CACHE: Map<string, { data: unknown; ts: number }> = new Map();

function ledgerTTL(fromStr: string, toStr: string): number {
  const diffDays = (new Date(toStr).getTime() - new Date(fromStr).getTime()) / 86_400_000;
  return diffDays <= 90 ? 3 * 60_000 : 15 * 60_000;
}

export async function cachedGetLedger(fromStr: string, toStr: string): Promise<unknown> {
  const key = `ledger:${fromStr}:${toStr}`;
  const hit = LEDGER_CACHE.get(key);
  if (hit && Date.now() - hit.ts < ledgerTTL(fromStr, toStr)) return hit.data;
  const data = await dhanClient.getLedger(fromStr, toStr);
  LEDGER_CACHE.set(key, { data, ts: Date.now() });
  return data;
}

export async function cachedGetAllLedger(fromStr: string, toStr: string): Promise<Record<string, unknown>[]> {
  const key = `allLedger:${fromStr}:${toStr}`;
  const hit = LEDGER_CACHE.get(key);
  if (hit && Date.now() - hit.ts < ledgerTTL(fromStr, toStr)) return hit.data as Record<string, unknown>[];
  const data = await dhanClient.getAllLedger(fromStr, toStr);
  LEDGER_CACHE.set(key, { data, ts: Date.now() });
  return data;
}

/** Clear all cached ledger entries — call on broker disconnect. */
export function clearLedgerCache(): void {
  LEDGER_CACHE.clear();
}

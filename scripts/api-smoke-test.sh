#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Rajesh Algo — API Smoke Test
# Run: bash scripts/api-smoke-test.sh
# Tests every working endpoint. Exit 0 = all pass. Exit 1 = one or more failed.
# ─────────────────────────────────────────────────────────────────────────────

BASE="http://localhost:8080/api"
PASS=0
FAIL=0
WARN=0

GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
CYAN="\033[36m"
BOLD="\033[1m"
RESET="\033[0m"

pad() { printf "%-54s" "$1"; }

check() {
  local label="$1" method="$2" url="$3" body="$4" expect="${5:-200}"
  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/_sr -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" -d "$body" "$url" 2>/dev/null)
  else
    code=$(curl -s -o /tmp/_sr -w "%{http_code}" -X "$method" "$url" 2>/dev/null)
  fi
  snippet=$(cat /tmp/_sr 2>/dev/null | head -c 160)
  ok=0; IFS=',' read -ra arr <<< "$expect"
  for c in "${arr[@]}"; do [ "$code" = "$c" ] && ok=1 && break; done
  pad "  $label"
  if [ "$ok" = "1" ]; then
    echo -e "${GREEN}✓ $code${RESET}"; PASS=$((PASS+1))
  else
    echo -e "${RED}✗ $code${RESET}  ← $snippet"; FAIL=$((FAIL+1))
  fi
}

warn() {
  local label="$1" method="$2" url="$3" body="$4" expect="${5:-200}"
  if [ -n "$body" ]; then
    code=$(curl -s -o /tmp/_sr -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" -d "$body" "$url" 2>/dev/null)
  else
    code=$(curl -s -o /tmp/_sr -w "%{http_code}" -X "$method" "$url" 2>/dev/null)
  fi
  snippet=$(cat /tmp/_sr 2>/dev/null | head -c 160)
  ok=0; IFS=',' read -ra arr <<< "$expect"
  for c in "${arr[@]}"; do [ "$code" = "$c" ] && ok=1 && break; done
  pad "  $label"
  if [ "$ok" = "1" ]; then
    echo -e "${GREEN}✓ $code${RESET}"; PASS=$((PASS+1))
  else
    echo -e "${YELLOW}~ $code${RESET}  (rate-limit/market ok)  ← $snippet"; WARN=$((WARN+1))
  fi
}

TODAY=$(date -u +%Y-%m-%d)
WEEK=$(date -u -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-7d +%Y-%m-%d 2>/dev/null || echo "2025-01-01")

echo ""
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}   Rajesh Algo — API Smoke Test  $(date +'%Y-%m-%d %H:%M:%S')${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo ""

# ── System / Health ───────────────────────────────────────────────────────────
echo -e "${BOLD}System / Health${RESET}"
check "GET /healthz"              GET "$BASE/healthz"
check "GET /rate-limits"          GET "$BASE/rate-limits"
echo ""

# ── Settings ─────────────────────────────────────────────────────────────────
echo -e "${BOLD}Settings${RESET}"
check "GET /settings"             GET "$BASE/settings"
check "GET /settings/audit-log"   GET "$BASE/settings/audit-log"
echo ""

# ── Funds ─────────────────────────────────────────────────────────────────────
echo -e "${BOLD}Funds${RESET}"
check "GET /funds"                GET "$BASE/funds"
warn  "POST /funds/margin (empty body → 400 ok)" \
                                  POST "$BASE/funds/margin" '{}' "200,400"
echo ""

# ── Orders ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}Orders${RESET}"
check "GET /orders"               GET "$BASE/orders"
echo ""

# ── Positions ─────────────────────────────────────────────────────────────────
echo -e "${BOLD}Positions${RESET}"
check "GET /positions"            GET "$BASE/positions"
echo ""

# ── Trades / Ledger ───────────────────────────────────────────────────────────
echo -e "${BOLD}Trades / Ledger${RESET}"
check "GET /trades"               GET "$BASE/trades"
check "GET /trades/history (7d)"  GET "$BASE/trades/history?fromDate=${WEEK}&toDate=${TODAY}&page=1"
check "GET /trades/ledger (7d)"   GET "$BASE/trades/ledger?fromDate=${WEEK}&toDate=${TODAY}"
echo ""

# ── Dashboard ─────────────────────────────────────────────────────────────────
echo -e "${BOLD}Dashboard${RESET}"
check "GET /dashboard/summary"              GET "$BASE/dashboard/summary"
check "GET /dashboard/period-pnl"           GET "$BASE/dashboard/period-pnl"
check "GET /dashboard/equity-curve (7d)"    GET "$BASE/dashboard/equity-curve?mode=7d"
check "GET /dashboard/equity-curve (30d)"   GET "$BASE/dashboard/equity-curve?mode=30d"
check "GET /dashboard/equity-curve (365d)"  GET "$BASE/dashboard/equity-curve?mode=365d"
check "GET /dashboard/equity-curve (all)"   GET "$BASE/dashboard/equity-curve?mode=alltime"
check "GET /dashboard/recent-activity"      GET "$BASE/dashboard/recent-activity"
echo ""

# ── Market Data ───────────────────────────────────────────────────────────────
echo -e "${BOLD}Market Data${RESET}"
warn "GET /market/ltp (NSE_EQ 1333)"         GET "$BASE/market/ltp?exchSeg=NSE_EQ&secId=1333"
sleep 1
warn "GET /market/expiry-list (NIFTY/OPTIDX)" GET "$BASE/market/expiry-list?underlyingSecId=13&instrument=OPTIDX"
sleep 1
warn "POST /market/quote (NSE_EQ 1333)"      POST "$BASE/market/quote" \
       '{"securities":{"NSE_EQ":["1333"]},"quoteType":"ltp"}' "200,429"
echo ""

# ── Super Orders ──────────────────────────────────────────────────────────────
echo -e "${BOLD}Super Orders${RESET}"
check "GET /super-orders"         GET "$BASE/super-orders"
echo ""

# ── Risk ──────────────────────────────────────────────────────────────────────
echo -e "${BOLD}Risk${RESET}"
check "GET /risk/killswitch"      GET "$BASE/risk/killswitch"
echo ""

# ── Instruments / Search ──────────────────────────────────────────────────────
echo -e "${BOLD}Instruments${RESET}"
check "GET /instruments/search (NIFTY)"          GET "$BASE/instruments/search?q=NIFTY&limit=5"
check "GET /instruments/option-underlyings"       GET "$BASE/instruments/option-underlyings?q=NIFTY"
echo ""

# ── Logs ─────────────────────────────────────────────────────────────────────
echo -e "${BOLD}Logs${RESET}"
check "GET /logs"                 GET "$BASE/logs"
check "GET /logs/counts"          GET "$BASE/logs/counts"
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
TOTAL=$((PASS+FAIL+WARN))
echo -e "  Total: ${TOTAL}   ${GREEN}${BOLD}Passed: ${PASS}${RESET}   ${YELLOW}Warnings: ${WARN}${RESET}   ${RED}${BOLD}Failed: ${FAIL}${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}  ✗ SMOKE TEST FAILED — ${FAIL} endpoint(s) broken${RESET}"
  echo ""
  exit 1
else
  echo -e "${GREEN}${BOLD}  ✓ All critical endpoints healthy (${WARN} warnings are expected)${RESET}"
  echo ""
  exit 0
fi

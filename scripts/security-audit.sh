#!/usr/bin/env bash
# =============================================================================
# Security Audit Script
# =============================================================================
# Runs pnpm audit and reports vulnerabilities at moderate severity or above.
# Exits with code 1 if any moderate/high/critical issues are found.
# Exits with code 2 on parse/execution errors (fail-closed).
#
# Usage:
#   ./scripts/security-audit.sh              # interactive (colored output)
#   ./scripts/security-audit.sh --json       # also write security-audit-report.json
#   pnpm run audit:ci                        # used by GitHub Actions
# =============================================================================

set -euo pipefail

AUDIT_LEVEL="${AUDIT_LEVEL:-moderate}"
JSON_OUTPUT=false
REPORT_FILE="security-audit-report.json"

for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
  esac
done

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}============================================${RESET}"
echo -e "${BOLD}${CYAN}   Dependency Security Audit               ${RESET}"
echo -e "${BOLD}${CYAN}   Audit level: ${AUDIT_LEVEL}${RESET}"
echo -e "${BOLD}${CYAN}   $(date -u '+%Y-%m-%d %H:%M:%S UTC')${RESET}"
echo -e "${BOLD}${CYAN}============================================${RESET}"
echo ""

# Run audit and capture JSON output.
# pnpm audit exits non-zero when vulns exist — capture that via `|| true`
# so we can parse counts ourselves and produce a clean report.
RAW_JSON=$(pnpm audit --json 2>&1 || true)

if [ -z "$RAW_JSON" ]; then
  echo -e "${RED}${BOLD}ERROR: pnpm audit produced no output. Cannot determine vulnerability state.${RESET}"
  exit 2
fi

if [ "$JSON_OUTPUT" = true ]; then
  printf '%s' "$RAW_JSON" > "$REPORT_FILE"
  echo -e "${CYAN}Full audit report written to: ${REPORT_FILE}${RESET}"
fi

# Parse vulnerability counts via Node. Fail closed (exit 2) on any error
# so that a broken or truncated audit response doesn't silently pass CI.
PARSE_RESULT=$(node -e "
  const raw = process.argv[1];
  try {
    const j = JSON.parse(raw);
    const v = j && j.metadata && j.metadata.vulnerabilities;
    if (!v || typeof v !== 'object') {
      process.stderr.write('Audit JSON is missing metadata.vulnerabilities\n');
      process.exit(2);
    }
    process.stdout.write([
      v.critical || 0,
      v.high      || 0,
      v.moderate  || 0,
      v.low       || 0
    ].join(' '));
  } catch (e) {
    process.stderr.write('Failed to parse audit JSON: ' + e.message + '\n');
    process.exit(2);
  }
" -- "$RAW_JSON" 2>&1) || {
  echo -e "${RED}${BOLD}ERROR: Audit output could not be parsed. Failing closed.${RESET}"
  echo -e "${YELLOW}Raw output (first 500 chars):${RESET}"
  echo "${RAW_JSON:0:500}"
  exit 2
}

read -r CRITICAL HIGH MODERATE LOW <<<"$PARSE_RESULT"

echo -e "  ${BOLD}Vulnerability summary:${RESET}"
echo -e "    Critical : ${RED}${BOLD}${CRITICAL}${RESET}"
echo -e "    High     : ${RED}${HIGH}${RESET}"
echo -e "    Moderate : ${YELLOW}${MODERATE}${RESET}"
echo -e "    Low      : ${LOW}"
echo ""

ACTIONABLE=$((CRITICAL + HIGH + MODERATE))

if [ "$ACTIONABLE" -gt 0 ]; then
  echo -e "${RED}${BOLD}ACTION REQUIRED: ${ACTIONABLE} vulnerability(ies) at or above '${AUDIT_LEVEL}' severity found.${RESET}"
  echo ""
  echo -e "${YELLOW}Details:${RESET}"
  pnpm audit --audit-level "$AUDIT_LEVEL" 2>&1 || true
  echo ""
  echo -e "${YELLOW}Remediation options:${RESET}"
  echo -e "  1. Run ${BOLD}pnpm audit --fix${RESET} to auto-apply available patches"
  echo -e "  2. Pin vulnerable packages in pnpm-workspace.yaml under ${BOLD}overrides${RESET}"
  echo -e "  3. Replace the package if no fix is available"
  echo ""

  # ---------------------------------------------------------------------------
  # Telegram notification
  # Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables (or
  # secrets) to receive alerts in your Telegram channel when vulnerabilities
  # are found. The notification is silently skipped if either variable is unset.
  # ---------------------------------------------------------------------------
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    REPO="${GITHUB_REPOSITORY:-this repository}"
    RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-}"

    TG_TEXT="🚨 *Security Audit Failed*

*Repository:* \`${REPO}\`
*Severity counts:*
  • Critical : ${CRITICAL}
  • High     : ${HIGH}
  • Moderate : ${MODERATE}

${ACTIONABLE} vulnerability(ies) at or above \`${AUDIT_LEVEL}\` severity require attention.
${GITHUB_RUN_ID:+
🔗 [View audit run](${RUN_URL})}"

    TG_RESPONSE=$(curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":$(printf '%s' "$TG_TEXT" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))"),\"parse_mode\":\"Markdown\"}" \
      2>&1) && TG_OK=$(node -e "try{const r=JSON.parse(process.argv[1]);process.stdout.write(r.ok?'yes':'no')}catch{process.stdout.write('no')}" -- "$TG_RESPONSE") || TG_OK="no"
    if [ "$TG_OK" = "yes" ]; then
      echo -e "${CYAN}Telegram alert sent.${RESET}"
    else
      echo -e "${YELLOW}Warning: Telegram alert could not be delivered.${RESET}"
    fi
  fi

  exit 1
else
  echo -e "${GREEN}${BOLD}All clear — no vulnerabilities at '${AUDIT_LEVEL}' severity or above.${RESET}"
  echo ""
  exit 0
fi

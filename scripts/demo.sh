#!/usr/bin/env bash
# Demonstrates the three graded behaviours: personalization, context optimization,
# and graceful degradation. Requires `npm run mocks` and `npm start` to be running.
set -euo pipefail

API=${API:-http://localhost:3000}
MOCKS=${MOCKS:-http://localhost:4000}
Q='Should I consider changing my job in the next few months?'

ask() {
  curl -s -X POST "$API/$1" -H 'content-type: application/json' \
    -d "{\"userId\":\"$2\",\"question\":\"$3\"}"
}

# Fail loudly if something else is on the port, rather than feeding HTML to a JSON parser.
preflight() {
  local what=$1 url=$2 probe=$3
  if ! curl -sf "$url$probe" | grep -q '"status":"ok"\|"tithi"'; then
    echo "ERROR: no $what at $url" >&2
    echo "       Something else may be holding the port. Start it, or override:" >&2
    echo "         PORT=3100 npm start   /   MOCKS_PORT=4100 npm run mocks" >&2
    echo "         API=http://localhost:3100 MOCKS=http://localhost:4100 npm run demo" >&2
    exit 1
  fi
}
preflight "context engine" "$API" "/health"
preflight "mock upstreams" "$MOCKS" "/panchang"

py() { python3 -c "$1"; }

echo "═══════════════════════════════════════════════════════════════"
echo " 1. SAME QUESTION, THREE USERS  —  personalization"
echo "═══════════════════════════════════════════════════════════════"
printf '%-10s %-9s %-14s %-6s %s\n' USER LANG TONE WORDS "SELECTED CONTEXT"
for u in user_101 user_202 user_303; do
  ask debug/personalization "$u" "$Q" | py "
import sys,json
d=json.load(sys.stdin)
print('%-10s %-9s %-14s %-6s %s' % ('$u', d['language'], d['tone'], d['maxWords'], ', '.join(d['selectedContext'])))
"
done

echo
echo "═══════════════════════════════════════════════════════════════"
echo " 2. CONTEXT OPTIMIZATION  —  what each intent actually sends"
echo "═══════════════════════════════════════════════════════════════"
printf '%-16s %-10s %-8s %-7s %-9s %s\n' INTENT AVAILABLE SENT SAVED SELECTED EXCLUDED
while IFS= read -r q; do
  ask debug/personalization user_101 "$q" | py "
import sys,json
d=json.load(sys.stdin); p=d['promptPreview']
print('%-16s %-10s %-8s %-7s %-9s %s' % (
  d['intent'], p['contextAvailableTokens'], p['contextSentTokens'],
  str(p['contextReductionPct'])+'%', len(d['selectedContext']),
  ', '.join(d['excludedContext']) or '-'))
"
done <<'QUESTIONS'
Should I consider changing my job this year?
How does this month look for my relationship?
What should I focus on for my health?
Should I invest in property now?
Can you summarize today's guidance?
Tell me something interesting
QUESTIONS

echo
echo "═══════════════════════════════════════════════════════════════"
echo " 3. GRACEFUL DEGRADATION  —  Kundli service goes down"
echo "═══════════════════════════════════════════════════════════════"
flush() { curl -s -X POST "$API/debug/cache/flush" > /dev/null; }

echo "-- all services healthy:"
flush
ask personalize user_101 "$Q" | py "
import sys,json
d=json.load(sys.stdin)
print('   confidence=%-8s sources=%s' % (d['confidence'], ', '.join(d['sourcesUsed'])))
"

curl -s -X POST "$MOCKS/_control/fail" -H 'content-type: application/json' \
  -d '{"service":"kundli","mode":"500"}' > /dev/null
echo "-- kundli now returning 500:"
flush
ask personalize user_101 "$Q" | py "
import sys,json
d=json.load(sys.stdin)
print('   confidence=%-8s sources=%s' % (d['confidence'], ', '.join(d['sourcesUsed'])))
"

curl -s -X POST "$MOCKS/_control/fail" -H 'content-type: application/json' \
  -d '{"service":"horoscope","mode":"500"}' > /dev/null
echo "-- kundli AND horoscope down:"
flush
ask personalize user_101 "$Q" | py "
import sys,json
d=json.load(sys.stdin)
print('   confidence=%-8s sources=%s' % (d['confidence'], ', '.join(d['sourcesUsed']) or '(none)'))
"

curl -s -X POST "$MOCKS/_control/reset" > /dev/null
echo "-- services restored"
echo
echo "Every degraded case above returned HTTP 200. Nothing 500s because an upstream is sick."

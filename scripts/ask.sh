#!/usr/bin/env bash
# Ask the engine a question and see both the answer and the reasoning behind it.
#
#   ./scripts/ask.sh "Should I change my job?"
#   ./scripts/ask.sh "How is my health?" user_202
#
# Env: API (default http://localhost:3000), USER_ID (default user_101)
set -euo pipefail

API=${API:-http://localhost:3000}
Q=${1:-}
UID_ARG=${2:-${USER_ID:-user_101}}

if [ -z "$Q" ]; then
  echo "usage: ./scripts/ask.sh \"your question here\" [userId]" >&2
  echo "       users: user_101 (en/motivational/premium)" >&2
  echo "              user_202 (hi/neutral/free)" >&2
  echo "              user_303 (en/direct/premium)" >&2
  exit 1
fi

body=$(python3 -c "import json,sys; print(json.dumps({'userId': sys.argv[1], 'question': sys.argv[2]}))" "$UID_ARG" "$Q")

call() { curl -sf -X POST "$API/$1" -H 'content-type: application/json' -d "$body"; }

if ! curl -sf "$API/health" >/dev/null 2>&1; then
  echo "ERROR: no engine at $API" >&2
  echo "       start it, or set API=http://localhost:3100" >&2
  exit 1
fi

echo "──────────────────────────────────────────────────────────────"
echo "Q: $Q"
echo "   (as $UID_ARG)"
echo "──────────────────────────────────────────────────────────────"

call debug/personalization | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = d['promptPreview']
print()
print('  HOW IT READ THE QUESTION')
print('    intent            %s  (via %s, expected confidence %s)' % (d['intent'], d['intentMethod'], d['expectedConfidence']))
print('    language / tone   %s / %s, max %s words' % (d['language'], d['tone'], d['maxWords']))
print()
print('  CONTEXT IT CHOSE')
for s in d['selectedContext']:
    print('    + %s' % s)
for e in d['exclusionReasons']:
    print('    - %s   (%s)' % (e['label'], e['reason']))
print()
print('    context tokens    %s of %s available  -> %s%% saved' % (p['contextSentTokens'], p['contextAvailableTokens'], p['contextReductionPct']))
if d['degradations']:
    print('    degradations      %s' % ', '.join(d['degradations']))
print()
"

call personalize | python3 -c "
import sys, json, textwrap
d = json.load(sys.stdin)
print('  ANSWER  [confidence: %s]' % d['confidence'])
for line in textwrap.wrap(d['answer'], 70):
    print('    %s' % line)
print()
print('  SOURCES USED')
print('    %s' % (', '.join(d['sourcesUsed']) or '(none)'))
print()
"

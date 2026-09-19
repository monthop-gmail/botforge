#!/usr/bin/env bash
# ============================================================================
# collab-inbox.sh — กล่องงานของ instance + ด่านตรวจก่อนเปิดสิทธิ์เขียน
#
# ทำสองอย่างที่ Pilot #3 ต้องการ และทำได้ก่อนที่ credential จะมาถึง
#
#   ./scripts/collab-inbox.sh              # งานที่รออยู่ (อ่านอย่างเดียว)
#   ./scripts/collab-inbox.sh --gates      # ตรวจ gate A-E ว่าเปิด write ได้ยัง
#   ./scripts/collab-inbox.sh --plan       # จะเรียกอะไรบ้างถ้ารับใบแรก (ไม่ยิงจริง)
#
# 🔴 สคริปต์นี้ไม่เขียนอะไรกลับไปที่ ai-collaboration-mcp เลยแม้แต่ครั้งเดียว
#    ต่อให้เปิด AI_COLLAB_WRITE_ENABLED แล้วก็ตาม — --plan พิมพ์ออกมาเฉย ๆ
#    การเขียนจริงเป็นหน้าที่ของ Hermes ผ่าน MCP ไม่ใช่ของสคริปต์ข้างนอก
#
# ทำไมต้องอ่านจาก waiting_for_you ไม่ใช่ get_handoffs:
#   get_handoffs เป็น query ทั่วทั้ง workspace ที่รับ filter ได้ ไม่ใช่กล่อง
#   จดหมายส่วนตัว — เรียกด้วย identity ไหนก็เห็นเท่ากัน (วัดจริงแล้วใน Pilot #2)
#   ส่วน waiting_for_you จับคู่กับ identity ของ connection จึงเป็นกล่องจริง
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'
BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'

MODE=inbox
case "${1:-}" in
  --gates) MODE=gates ;;
  --plan)  MODE=plan ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
esac

[ -f .env ] && set -a && . ./.env && set +a
READ_KEY="${MCP_AI_COLLAB_API_KEY:-}"
[ -z "$READ_KEY" ] && [ -f data/.env ] && READ_KEY=$(grep -E '^MCP_AI_COLLAB_API_KEY=' data/.env 2>/dev/null | cut -d= -f2-)
WRITE_KEY="${MCP_AI_COLLAB_WRITE_API_KEY:-}"
[ -z "$WRITE_KEY" ] && [ -f data/.env ] && WRITE_KEY=$(grep -E '^MCP_AI_COLLAB_WRITE_API_KEY=' data/.env 2>/dev/null | cut -d= -f2-)

URL="${AI_COLLAB_URL:-}"
NAME="${AI_COLLAB_CLIENT_NAME:-}"

# ── ด่านตรวจ gate A-E ───────────────────────────────────────────────────────
if [ "$MODE" = gates ]; then
  echo "${BOLD}ด่านตรวจก่อนเปิดสิทธิ์เขียน (Pilot #3 gate A-E)${RESET}"
  echo
  fail=0
  chk() { # chk <ผ่าน?> <ชื่อ> <รายละเอียด>
    if [ "$1" = yes ]; then printf '  %s✓%s %-46s %s\n' "$GREEN" "$RESET" "$2" "${3:-}"
    else printf '  %s✗%s %-46s %s\n' "$RED" "$RESET" "$2" "${3:-}"; fail=$((fail+1)); fi
  }
  [ -n "$WRITE_KEY" ] && a=yes || a=no
  chk "$a" "A. credential ของ instance เอง" \
      "$([ "$a" = yes ] && echo 'มีใบแล้ว' || echo 'ยังไม่มี MCP_AI_COLLAB_WRITE_API_KEY')"
  if [ "$a" = no ]; then
    echo "      ${DIM}ออกใบด้วย MCP_AUTH_TOKENS: <token>=${NAME:-monthop-gmail/<instance>}${RESET}"
    echo "      ${DIM}ห้ามใช้ใบของ ai-collab (อ่าน) แทน — นั่นคือ shared bearer ที่ปลอมชื่อได้${RESET}"
  fi
  if [ -n "$READ_KEY" ] && [ "$READ_KEY" = "$WRITE_KEY" ]; then
    chk no "A'. ใบเขียนต้องไม่ใช่ใบเดียวกับใบอ่าน" "ตอนนี้เป็นใบเดียวกัน"
  fi
  # B: allowlist ในไฟล์ config จริง
  cfg=data/config.yaml
  if [ -f "$cfg" ]; then
    banned=$(grep -oE 'create_task|create_handoff|record_decision|record_plan|resolve_decision' "$cfg" | sort -u | tr '\n' ' ')
    [ -z "$banned" ] && chk yes "B. allowlist มีแค่ coordination" "accept_handoff / post_message / update_task" \
                     || chk no  "B. allowlist มีแค่ coordination" "พบที่ห้าม: $banned"
  else
    chk no "B. allowlist มีแค่ coordination" "ยังไม่มี data/config.yaml"
  fi
  chk yes "C. กฎ evidence เขียนไว้ใน config แล้ว" "claim → evidence ref → result"
  [ "${AI_COLLAB_WRITE_ENABLED:-false}" = false ] && d=yes || d=no
  chk "$d" "D. write ปิดเป็นค่าเริ่มต้น" "AI_COLLAB_WRITE_ENABLED=${AI_COLLAB_WRITE_ENABLED:-false}"
  chk no "E. เทสต์แรกเป็น task เล็กใช้แล้วทิ้ง" "ยังไม่ได้รัน — ต้องรอ gate A"
  echo
  if [ "$fail" -eq 0 ]; then
    echo "  ${GREEN}${BOLD}ผ่านครบ — เปิด AI_COLLAB_WRITE_ENABLED=true ได้${RESET}"
  else
    echo "  ${YELLOW}${BOLD}ยังไม่ผ่าน $fail ข้อ — write ต้องปิดไว้ก่อน${RESET}"
  fi
  exit 0
fi

# ── แผนการเรียก ถ้ารับใบแรก (ไม่ยิงจริง) ───────────────────────────────────
if [ "$MODE" = plan ]; then
  cat <<PLAN
${BOLD}ลำดับที่ loop จะเรียก เมื่อมีงานหนึ่งใบ${RESET}   ${DIM}(พิมพ์เฉย ๆ ไม่ยิงจริง)${RESET}

  1. get_workspace_context(limit=1)
     └─ อ่าน open_items.waiting_for_you.unaccepted.handoffs
        ${DIM}ว่างเปล่า = ไม่มีงาน จบรอบ ไม่เรียกอะไรต่อ${RESET}

  2. get_discussion(discussion_id ของใบนั้น)        ${DIM}เอาบริบทมาอ่านก่อนตัดสินใจ${RESET}

  3. accept_handoff(handoff_id)                     ${YELLOW}← เขียนครั้งแรก${RESET}
     ${DIM}ต้องผ่าน gate A-E ครบก่อน ไม่งั้นหยุดที่ขั้น 2${RESET}

  4. ลงมือทำงาน — นอกขอบเขตของ MCP ทั้งหมด
     ${DIM}ผลที่ได้ต้องเป็นของที่ชี้ได้ เช่น output เทสต์ / commit / response${RESET}

  5. post_message(kind=note, body=รายงาน + evidence reference)
     ${DIM}ไม่มีหลักฐาน → รายงาน blocked ไม่ใช่ done${RESET}

  6. update_task(status=done|blocked)               ${DIM}ปิดตาม lifecycle เท่านั้น${RESET}

${BOLD}ที่ไม่อยู่ในแผนนี้โดยตั้งใจ${RESET}
  create_task / create_handoff   ${DIM}= สั่งงานคนอื่น ไม่ใช่ทำงานที่ถูกสั่ง${RESET}
  record_decision / record_plan  ${DIM}= ตัดสินใจแทนทีม${RESET}
  shell / git / deploy           ${DIM}= privilege ที่ pilot นี้ไม่แตะ${RESET}
PLAN
  exit 0
fi

# ── กล่องงาน (อ่านอย่างเดียว) ───────────────────────────────────────────────
if [ -z "$URL" ] || [ -z "$READ_KEY" ]; then
  echo "${YELLOW}! ยังต่อไม่ได้${RESET} — ต้องมี AI_COLLAB_URL และ MCP_AI_COLLAB_API_KEY"
  echo "${DIM}  ดูสถานะด่านตรวจ: ./scripts/collab-inbox.sh --gates${RESET}"
  exit 1
fi

resp=$(curl -s -X POST "$URL" \
  -H "Authorization: Bearer $READ_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  ${NAME:+-H "X-Client-Name: $NAME"} \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_workspace_context","arguments":{"limit":1}}}')

printf '%s' "$resp" | python3 -c '
import json, sys
raw = sys.stdin.read()
doc = None
for line in raw.splitlines():
    if line.startswith("data: "):
        env = json.loads(line[6:])
        if "result" in env:
            doc = json.loads(env["result"]["content"][0]["text"])
if doc is None:
    print("  ตอบกลับผิดรูป:", raw[:200]); sys.exit(1)
w = doc["open_items"]["waiting_for_you"]
print()
print("  identity ที่ server เห็น :", doc["you_are"])
print("  งานที่ยังไม่ได้รับ       :", len(w["unaccepted"]["handoffs"]), "ใบ")
for h in w["unaccepted"]["handoffs"]:
    print("     -", h["id"], "จาก", h["from"], "·", h["state"])
print("  งานที่รับแล้วกำลังทำ     :", w["in_progress"]["total"], "ใบ")
print()
if not w["unaccepted"]["handoffs"]:
    print("  ไม่มีงานใหม่ — loop จบรอบตรงนี้ ไม่เรียก tool อื่นต่อ")
'

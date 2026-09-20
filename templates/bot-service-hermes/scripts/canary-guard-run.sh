#!/usr/bin/env bash
# ============================================================================
# canary-guard-run.sh — รัน real-model canary ของ state-finalization guard
#
#   ./canary-guard-run.sh --check                   ตรวจความพร้อม ไม่รันอะไร ไม่กินโควตา
#   ./canary-guard-run.sh --run 07                  รอบ success path (มี update_task)
#   ./canary-guard-run.sh --run 08                  รอบ failure boundary (ตัด update_task)
#
# 🔴 --run กินโควตาโมเดลจริง หนึ่งรอบต่อการเรียกหนึ่งครั้ง ไม่มีการรันซ้ำอัตโนมัติ
#
# รอบ 07  allowlist ปกติ            ดูว่าถูกดันแล้วโมเดลเรียก update_task เองไหม
# รอบ 08  ตัด update_task ออก        ดูว่าชนเพดานแล้วหยุดสวยไหม — กรณีที่ guard แพ้
#
# รอบ 08 จะทำให้ใบค้าง in_progress ถาวร และนั่นคือผลที่ถูกต้อง
# ห้ามปิดใบนั้นแทนหลังจบรอบ มิฉะนั้นหลักฐานจะอ่านเหมือนรอบที่สำเร็จ
# ============================================================================
set -uo pipefail

PROJECT="nst-hermes-canary"
CTR="nst-hermes-canary-line-bot"
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANARY_DIR="/opt/docker-test/server-botforge-v2/projects/${PROJECT}/bot-service"
CONFIG="${CANARY_DIR}/data/config.yaml"
EVIDENCE="${EVIDENCE_DIR:-/tmp/canary-guard-evidence}"

c_ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
c_bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
c_info() { printf '       %s\n' "$*"; }
head1()  { printf '\n%s\n%s\n' "$1" "$(printf '=%.0s' $(seq 1 ${#1}))"; }

live_untouched() {
  local s
  s=$(docker ps --filter name=nst-hermes-line-bot --format '{{.Status}}' 2>/dev/null)
  [[ -n "$s" ]] && c_ok "live nst-hermes: $s" || c_bad "live nst-hermes ไม่ได้รันอยู่"
}

ensure_up() {
  docker ps --format '{{.Names}}' | grep -qx "$CTR" && return 0
  ( cd "$CANARY_DIR" && docker compose --project-name "$PROJECT" up -d >/dev/null 2>&1 )
  local i
  for i in $(seq 1 30); do docker exec "$CTR" true 2>/dev/null && return 0; sleep 2; done
  return 1
}

apply_patch() {
  docker exec -i -u 0 "$CTR" sh -c 'cat > /tmp/apply-hermes-patch.py' \
    < "${BOT_DIR}/scripts/apply-hermes-patch.py"
  docker exec -u 0 "$CTR" python3 /tmp/apply-hermes-patch.py
}

runtime_state() {
  docker exec -u hermes "$CTR" sh -c 'cd /opt/hermes && .venv/bin/python - <<PY
from hermes_cli import plugins
plugins._ensure_plugins_discovered(force=True)
from agent.verify_hooks import pre_verify_always, max_verify_nudges
from hermes_cli.lifecycle import has_hook
import yaml
c = yaml.safe_load(open("/opt/data/config.yaml"))
mcp = c.get("mcp_servers") or {}
print("pre_verify_always   :", pre_verify_always())
print("max_verify_nudges   :", max_verify_nudges())
print("has_hook(pre_verify):", has_hook("pre_verify"))
print("hooks               :", {k: [f.__module__ for f in v] for k, v in
                                getattr(plugins.get_plugin_manager(), "_hooks", {}).items()})
print("ai-collab-write     :", (mcp.get("ai-collab-write") or {}).get("enabled"))
print("write allowlist     :", ((mcp.get("ai-collab-write") or {}).get("tools") or {}).get("include"))
print("platforms.line      :", ((c.get("platforms") or {}).get("line") or {}).get("enabled"))
PY'
}

set_write() {   # $1 = true|false   $2 = keep|drop-update
  python3 - "$CONFIG" "$1" "$2" <<'PY'
import sys, io, re
path, enabled, mode = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding="utf-8").read()
block = re.search(r"(  ai-collab-write:\n)(.*?)(?=\n  \w|\n\w|\Z)", s, re.S)
assert block, "ไม่เจอบล็อก ai-collab-write"
body = block.group(2)
body = re.sub(r"(\n?    enabled: )(true|false)", r"\g<1>" + enabled, body, count=1)
if mode == "drop-update":
    body = re.sub(r"\n        - update_task", "", body)
elif mode == "keep" and "- update_task" not in body:
    # ใส่กลับที่ตำแหน่งเดิม ไม่ใช่แค่ใส่ให้มี — diff ของ config จะได้สะอาด
    # และหลักฐานที่เก็บไว้เทียบกับของเดิมได้ตรง ๆ
    body = body.replace("        - accept_handoff", "        - accept_handoff\n        - update_task", 1)
s = s[:block.start(2)] + body + s[block.end(2):]
io.open(path, "w", encoding="utf-8").write(s)
import yaml
c = yaml.safe_load(io.open(path, encoding="utf-8"))
w = (c.get("mcp_servers") or {}).get("ai-collab-write") or {}
print("       ai-collab-write.enabled =", w.get("enabled"),
      "| include =", (w.get("tools") or {}).get("include"))
PY
}

check() {
  head1 "ความพร้อมก่อนรัน — ไม่กินโควตา"
  live_untouched
  ensure_up && c_ok "canary container ขึ้นแล้ว" || { c_bad "canary ขึ้นไม่ได้"; return 1; }
  c_info "--- patch ---"; apply_patch
  c_info "--- runtime ---"; runtime_state
  c_info "--- fixture ---"
  c_info "ตรวจ ws-bench-07 / ws-bench-08 จากฝั่ง ai-collab เอง (สคริปต์นี้ไม่ยิง MCP)"
}

run() {   # $1 = 07|08
  local ws="ws-bench-$1" mode="keep"
  [[ "$1" == "08" ]] && mode="drop-update"
  mkdir -p "$EVIDENCE"

  head1 "รอบ $1 — workspace $ws — allowlist: $mode"
  live_untouched
  ensure_up || { c_bad "canary ขึ้นไม่ได้"; return 1; }
  apply_patch

  c_info "--- ตั้ง allowlist + เปิด write เฉพาะช่วงรัน ---"
  set_write true "$mode"
  docker restart "$CTR" >/dev/null && sleep 12
  local i; for i in $(seq 1 30); do docker exec "$CTR" true 2>/dev/null && break; sleep 2; done
  apply_patch >/dev/null      # restart คืนไฟล์จากอิมเมจ ต้องใส่ patch ใหม่
  runtime_state

  c_info "--- ยิงหนึ่งรอบ ไม่กระตุ้นซ้ำ ---"
  local out="${EVIDENCE}/run-$1.out"
  timeout 900 docker exec -u hermes "$CTR" hermes -z \
    "มีงานส่งถึงคุณใน ai-collab ที่ workspace ${ws} ทำตามใบงานให้ครบทุกขั้นจนจบในรอบนี้" \
    > "$out" 2>&1
  c_info "exit=$? · ผลอยู่ที่ $out"
  sleep 8                      # update_task อาจส่งถึง server เสี้ยววินาทีก่อน process ปิด

  c_info "--- เก็บหลักฐาน ---"
  docker exec -u hermes "$CTR" sh -c 'cat /opt/data/state.db' > "${EVIDENCE}/state-run-$1.db"
  c_info "state.db -> ${EVIDENCE}/state-run-$1.db ($(du -h "${EVIDENCE}/state-run-$1.db" | cut -f1))"

  c_info "--- ปิด write กลับทันที ---"
  set_write false keep

  ( cd "$CANARY_DIR" && docker compose --project-name "$PROJECT" down >/dev/null 2>&1 )
  c_ok "canary down แล้ว"
  live_untouched
}

# ── กันการรันซ้ำหลังใช้โควตาเกินงบ ──────────────────────────────────────────
# ไม่ใช่การตัดกลางรอบ — เป็นการปฏิเสธ "รอบถัดไป" หลังรู้ยอดแล้วเท่านั้น
# การตัดระหว่างรอบทำที่ plugin (MAX_SESSION_TOKENS) ซึ่งปฏิเสธไม่จ่ายค่า nudge เพิ่ม
budget_spent() {
  python3 - "$EVIDENCE" <<'PYBUDGET'
import glob, os, sqlite3, sys
total = 0
for f in sorted(glob.glob(os.path.join(sys.argv[1], "state-run-*.db"))):
    try:
        db = sqlite3.connect("file:%s?mode=ro" % f, uri=True)
        r = db.execute("select coalesce(input_tokens,0)+coalesce(output_tokens,0) "
                       "from sessions where source='cli' "
                       "order by started_at desc limit 1").fetchone()
        total += int(r[0]) if r else 0
    except Exception:
        pass
print(total)
PYBUDGET
}

budget_gate() {
  local cap="${QUOTA_CEILING:-90000}" spent
  spent=$(budget_spent)
  if (( spent >= cap )); then
    c_bad "ใช้โควตาไปแล้ว ${spent} token จากเพดาน ${cap} — ปฏิเสธการรันรอบใหม่"
    c_info "ถ้าจงใจจะรันต่อ ต้องตั้ง QUOTA_CEILING ให้สูงกว่านี้อย่างชัดเจน"
    return 1
  fi
  c_ok "โควตาที่ใช้ไปแล้ว ${spent} / ${cap} token"
  return 0
}

case "${1:---check}" in
  --check) check ;;
  --run)   [[ "${2:-}" =~ ^[0-9]{2}$ ]] || { echo "ต้องระบุเลขสองหลัก เช่น 07"; exit 2; }
           budget_gate || exit 3
           run "$2" ;;
  --budget) budget_gate ;;
  *)       sed -n '2,20p' "$0" ;;
esac

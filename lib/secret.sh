# lib/secret.sh — สุ่มรหัสผ่านให้ endpoint ที่เปิดออกอินเทอร์เน็ตผ่าน tunnel
#
# source เข้าไปในสคริปต์: . "$SCRIPT_DIR/lib/secret.sh"
#
# ⚠️ ทุกฟังก์ชันในไฟล์นี้ **ห้ามพิมพ์ค่ารหัสลง stderr หรือ stdout ที่ผู้ใช้เห็น**
#    gen_password() คืนค่าทาง stdout เพราะเป็น return value — ผู้เรียกต้องรับใส่ตัวแปร
#    ห้าม echo ต่อ

# ทำไมต้อง 32 ตัวอักษร base62: endpoint นี้เปิดให้อินเทอร์เน็ตยิงได้ไม่จำกัดรอบ
# ไม่มี rate limit ไม่มี lockout — ความยาวคือการป้องกันเดียวที่มี (~190 bit)
#
# ทำไม base62 ไม่ใช่ base64: ค่านี้ไปโผล่ใน .env, Authorization: Basic (base64
# ซ้อนอีกชั้น), และ URL ของ UI — `/`, `+`, `=` ทำให้เพี้ยนได้ทั้งสามที่
BOTFORGE_PASSWORD_LEN="${BOTFORGE_PASSWORD_LEN:-32}"

gen_password() {
    local len="${1:-$BOTFORGE_PASSWORD_LEN}" out=""

    if command -v openssl >/dev/null 2>&1; then
        # ขอมาเผื่อ เพราะ tr ตัด /+= ทิ้งไปเยอะ
        out=$(openssl rand -base64 $((len * 3)) | tr -dc 'A-Za-z0-9' | head -c "$len")
    elif command -v python3 >/dev/null 2>&1; then
        out=$(LEN="$len" python3 -c '
import os, secrets, string
print("".join(secrets.choice(string.ascii_letters + string.digits)
               for _ in range(int(os.environ["LEN"]))))')
    elif [[ -r /dev/urandom ]]; then
        out=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$len")
    fi

    # ⚠️ ห้าม fallback ไป $RANDOM — มันคือ LCG 15 bit ที่ seed จาก pid
    #    รหัสที่เดาได้แย่กว่าไม่มีรหัส เพราะมันดูปลอดภัย
    if [[ ${#out} -ne $len ]]; then
        echo "gen_password: หา entropy source ไม่ได้ (openssl/python3//dev/urandom)" >&2
        return 1
    fi
    printf '%s' "$out"
}

# ensure_secret <env-file> <KEY>
#   ตั้งค่า KEY ใน env-file ให้เป็นรหัสที่สุ่มใหม่ **เฉพาะเมื่อยังว่างหรือไม่มี**
#   ถ้ามีค่าอยู่แล้วจะไม่แตะ (ค่าที่ย้ายมาจาก V1 ต้องคงเดิม)
#
#   exit 0 = สุ่มให้ใหม่   ·   exit 1 = มีค่าอยู่แล้ว ไม่ได้แตะ
#   ไม่พิมพ์ค่าออกทั้งสองกรณี
ensure_secret() {
    local file="$1" key="$2" pw
    [[ -f "$file" ]] || { echo "ensure_secret: ไม่มีไฟล์ $file" >&2; return 2; }

    local cur
    cur=$(grep -m1 -E "^${key}=" "$file" 2>/dev/null | cut -d= -f2- | tr -d "\"' \r") || true
    [[ -n "$cur" ]] && return 1

    pw=$(gen_password) || return 2

    # python เพราะรหัสอาจมีอักขระที่ sed ตีความ และเราไม่อยากให้ค่าโผล่ใน argv
    # (argv เห็นได้จาก ps ของผู้ใช้อื่นบนเครื่องเดียวกัน) — ส่งผ่าน env แทน
    K="$key" V="$pw" F="$file" python3 - <<'PY'
import os, re
k, v, f = os.environ["K"], os.environ["V"], os.environ["F"]
lines = open(f).read().split("\n")
pat = re.compile(rf"^\s*#?\s*{re.escape(k)}=")   # ปลดคอมเมนต์ให้ด้วยถ้าถูก comment ไว้
hit = False
out = []
for l in lines:
    if not hit and pat.match(l):
        out.append(f"{k}={v}"); hit = True
    else:
        out.append(l)
if not hit:
    if out and out[-1] == "":
        out.insert(len(out) - 1, f"{k}={v}")
    else:
        out.append(f"{k}={v}")
open(f, "w").write("\n".join(out))
PY
    chmod 600 "$file"
    return 0
}

# secret_key_for <v1|v2> <engine|runtime>
#   key ใน .env ที่เป็นรหัสของ server — ว่าง = ไม่มี server แยกให้ป้องกัน
#
# ⚠️ ต้องบอกรุ่นเสมอ ห้ามให้เดาจากชื่อ — `codex` กับ `adkcode` เป็นชื่อที่มีทั้งสองรุ่น
#    แต่คนละความหมาย: V1 `codex` มี container `server` (Hono ห่อ CLI) ส่วน V2 `codex`
#    spawn app-server เป็น child process ไม่มี endpoint แยก
#    และ V1 `adkcode` ใช้ API_PASSWORD ส่วน V2 ใช้ SERVER_PASSWORD (compose map ให้เอง)
secret_key_for() {
    local gen="$1" name="$2"
    case "$gen" in
        v1)
            # V1 ทุก engine มี service `server` และ tunnel เปิด route ให้ทุกตัว
            case "$name" in
                opencode) echo "OPENCODE_PASSWORD" ;;
                # hermes ไม่มี container server — รหัสที่มีคือ basic auth ของ dashboard
                hermes)   echo "DASHBOARD_PASS" ;;
                *)        echo "API_PASSWORD" ;;
            esac ;;
        v2)
            case "$name" in
                opencode) echo "OPENCODE_PASSWORD" ;;
                adkcode)  echo "SERVER_PASSWORD" ;;
                *)        echo "" ;;   # codex/claude รันในตัว bot ไม่มี endpoint แยก
            esac ;;
        *)
            echo "secret_key_for: ต้องระบุ v1 หรือ v2 (ได้ '$gen')" >&2
            return 2 ;;
    esac
}

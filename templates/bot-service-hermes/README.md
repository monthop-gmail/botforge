# {{PROJECT_NAME}} — Hermes Agent × LINE OA

LINE bot ที่ขับด้วย [Hermes Agent](https://hub.docker.com/r/nousresearch/hermes-agent)
โดยรับโมเดลจาก LiteLLM gateway — คุยได้ทั้งแชทส่วนตัวและในกลุ่ม

## เทมเพลตนี้ต่างจาก engine ตัวอื่นของ botforge

```
engine อื่น:  LINE ──► botforge line-bot ──► engine server
              (bun + @line/bot-sdk ~1,300 บรรทัด)

hermes:       LINE ──► hermes  (มี LINE adapter ในตัว)
```

**Hermes เป็นเจ้าของ LINE channel เอง** — `plugins/platforms/line/adapter.py`
1,758 บรรทัดที่มาพร้อม image ทำให้แล้วทั้ง:

| ความสามารถ | |
|---|---|
| แชทส่วนตัว / กลุ่ม (C…) / ห้อง (R…) | ✅ |
| ตรวจลายเซ็น HMAC-SHA256 | ✅ |
| กัน webhook ส่งซ้ำ (`webhookEventId`) | ✅ |
| กันบอทตอบตัวเอง | ✅ |
| allowlist 3 ชั้น (user/group/room) | ✅ |
| reply token ก่อน แล้วค่อย Push | ✅ ประหยัดโควตาข้อความ OA |
| ตอบช้า → ปุ่ม postback ขอคำตอบด้วย token ใหม่ (ฟรี) | ✅ |
| ตัดข้อความยาวเป็นหลาย bubble (4,500 ตัว / ≤5 ต่อ call) | ✅ |
| รับรูป/เสียง/วิดีโอ/ไฟล์ | ✅ |

**เทมเพลตนี้จึงไม่มี `src/` ไม่มี `Dockerfile` ไม่มี `package.json`** — มีแต่ config

> ⚠️ **ไม่มีเงื่อนไข @mention** — ในกลุ่มที่ผ่าน allowlist บอทตอบ **ทุกข้อความ**
> (adapter ไม่มี logic mention เลย ต่างจาก Mattermost ที่มี `MATTERMOST_REQUIRE_MENTION`)
> กลุ่มที่คนคุยกันเยอะจะเผาโควตาโมเดลเร็วมาก — ตั้ง `LINE_ALLOWED_GROUPS` ให้แคบไว้ก่อน

## เริ่มใช้

ต้องมี **LiteLLM gateway** รันอยู่บนเครื่องนี้ และอยู่บน network `llm-clients`:

```bash
docker network create llm-clients
docker network connect llm-clients llm-litellm
```

แล้วออก **virtual key แยกใบ** ให้ project นี้ (อย่าใช้ master key — มันเป็น admin
ของทั้ง gateway: ออก/เพิกถอน key คนอื่นได้ ข้าม budget ได้) เอาไปใส่ `LITELLM_KEY` ใน `.env`

```bash
./scripts/init.sh            # เตรียม data/ + gen config + ตรวจทาง LiteLLM
docker compose up -d
docker compose logs -f line-bot
./scripts/trim-skills.sh     # ตัด bundled skills 71 → 4 (ลด token ต่อ call)
```

### ตั้ง LINE channel

[LINE Developers Console](https://developers.line.biz/console/) → Messaging API channel

- *Channel access token (long-lived)* → `LINE_CHANNEL_ACCESS_TOKEN`
- *Channel secret* (Basic settings) → `LINE_CHANNEL_SECRET`
- *Webhook URL* → `https://{{DOMAIN}}/webhook` → **Verify**
- *Use webhook* → เปิด
- *Auto-reply* / *Greeting messages* → **ปิด** (ไม่งั้นชนกับบอท)
- *Allow bot to join group chats* → **เปิด** ← ขาดข้อนี้แล้วใช้ในกลุ่มไม่ได้

### เก็บ id แล้วปิด allowlist

```bash
# รอบแรก: เปิดรับทุกคนชั่วคราว
sed -i 's/^LINE_ALLOW_ALL_USERS=.*/LINE_ALLOW_ALL_USERS=true/' .env
docker compose up -d --force-recreate line-bot
docker compose logs -f line-bot | grep -i "line:"     # ทักบอท แล้วดู U… / C…

# ใส่ id ที่ได้ลง LINE_ALLOWED_USERS / LINE_ALLOWED_GROUPS แล้วปิดกลับ
sed -i 's/^LINE_ALLOW_ALL_USERS=.*/LINE_ALLOW_ALL_USERS=false/' .env
docker compose up -d --force-recreate line-bot
```

> 🔴 **ห้ามเขียนคอมเมนต์ต่อท้ายบรรทัดค่าใน `.env`** — docker compose ไม่ตัด
> inline comment ตัวคอมเมนต์จะกลายเป็นส่วนหนึ่งของค่าและเข้าไปอยู่ใน allowlist จริง ๆ

### ทดสอบโดยไม่ต้องมี LINE จริง

```bash
./scripts/smoke-webhook.sh                  # แชทส่วนตัว
./scripts/smoke-webhook.sh --group          # ในกลุ่ม
./scripts/smoke-webhook.sh --bad-sig        # ต้องได้ 401
./scripts/smoke-webhook.sh --id Ufffffff…   # ทดสอบว่า allowlist กันคนนอกจริง
```

ยิง webhook ที่ **เซ็นด้วย channel secret จริง** พิสูจน์ได้ทั้งเส้น
ลายเซ็น → allowlist → session → โมเดล (ส่งกลับ LINE ไม่ได้เพราะ reply token ปลอม
— คำตอบไปโผล่ใน `docker compose logs line-bot`)

## โมเดล

Hermes กิน **~16K tokens ต่อ 1 call** (system prompt + tool schemas) และวิ่งด้วย
tool loop ล้วน ๆ โมเดลจึงต้องผ่าน 3 ข้อ ไม่ใช่แค่ "ตอบได้":

1. คืน `tool_calls` เป็น field จริง ไม่ใช่ `<tool_call>` ปนใน `content`
2. รับ prompt ~14K tokens ได้ ไม่เด้ง 429/413
3. **อยู่กับภาษาที่ผู้ใช้ใช้** ตอนบริบทเต็มไปด้วยอังกฤษ

```bash
./scripts/probe-litellm.sh    # ข้อ 1-2 (ยิง API ตรง)
./scripts/probe-thai.sh       # ข้อ 3 (ยิงผ่าน Hermes จริง) ← ข้อนี้ยิง API ตรงวัดไม่ได้
```

สลับโมเดลจากในแชท: `/model <ชื่อ>` (คำสั่ง built-in ของ Hermes)

### ⭐ ตรวจ chain ทุกวัน — `./scripts/check-chain.sh`

```bash
./scripts/check-chain.sh       # ยิงจริงทุกตัวที่ config อ้างถึง
./scripts/check-chain.sh -q    # เอาแต่ exit code (ใส่ cron ได้)
```

**chain ที่ไม่เคยถูกทดสอบ คือ chain ที่ไม่มีอยู่จริง** — ตัวสำรองพังแล้วบอทจะ
ไม่แสดงอาการอะไรเลยตราบใดที่ตัวหลักยังดีอยู่ กว่าจะรู้คือตอนตัวหลักพังพร้อมกัน

โปรเจกต์ต้นทาง (`hermes-line-bot`) เคยปล่อยให้ fallback อันดับ 1 ตายอยู่เป็น
สัปดาห์โดยไม่รู้ตัว 2 ครั้ง — `or/ox-alpha` จบช่วง stealth testing และ `zen/hy3`
ถูกผู้ให้บริการปิดชื่อ

นอกจากยิงทีละตัว มันตรวจ **โครงของ chain** ด้วย:

| | |
|---|---|
| **ปัญหา** (exit 1) | ชั้นติดกันอยู่ `quota_pool` เดียวกัน · ชื่อไม่มีใน `/model/info` · เป็น alias ไป provider อื่น |
| **เตือน** (exit 0) | `status: dead/unknown` · `tags: deprecated` · `stability` ไม่ใช่ `stable` · `free_until` ใกล้ถึง · `language_*: drift-*` · `status` ค้างเกิน 3 วัน |

> ⚠️ **ชื่อผิดใน chain ไม่มีใครบอก** — LiteLLM เงียบแล้วคืน error ของตัวหลักมาเฉย ๆ
> อาการเหมือนไม่ได้ตั้ง fallback เลยทุกประการ ต้องตรวจกับ `/model/info` ไม่ใช่รอ runtime
>
> `status: rate_limited` **ไม่ใช่คำเตือน** — ตัวสำรองที่ดีคือตัวที่ว่างตอนตัวหลักตาย

> 🔴 ประกาศ provider เป็น **`custom_providers:` (list)** ไม่ใช่ `providers:` (dict)
> ถ้าใช้ dict Hermes จะนับ provider ตัวเดียวเป็นสองตัว แล้ว `/model <ชื่อ>` จะ error
> *"is declared by multiple configured providers"* ทุกครั้ง

## ลด token ต่อ call

```bash
./scripts/trim-skills.sh                    # 71 → 4 skills (ตาม config/skills-keep.txt)
./scripts/trim-skills.sh --list-available   # ดูรายชื่อทั้งหมด
./scripts/trim-skills.sh --restore          # เอากลับมาทั้งหมด
docker exec {{CONTAINER_PREFIX}}-line-bot hermes prompt-size --platform line
```

`platform_toolsets` ใน `config/config.yaml.tmpl` เป็น **allowlist** ของ toolset
(ตัวที่ไม่อยู่ในลิสต์ = ปิด) — ตัด `browser` `delegation` `tts` `vision` ไว้แล้ว

## พฤติกรรมในกลุ่ม

`group_sessions_per_user: false` (ตั้งไว้ใน template) = **ทั้งกลุ่มใช้ session เดียว**
บอทเห็นบทสนทนาต่อเนื่องของทุกคน เหมาะกับ "ผู้ช่วยประจำกลุ่ม"

⚠️ ทุกคนในกลุ่มเห็นบริบทเดียวกัน **อย่าเอาข้อมูลลับเข้ากลุ่ม**
ถ้าต้องการแยกรายคนให้ตั้งเป็น `true` (เป็น default ของ Hermes เอง)

## ความเสี่ยงที่ต้องดู

| ความเสี่ยง | ทางรับมือ |
|---|---|
| **Hermes รันคำสั่งใน container ได้จริง** | allowlist แคบ + ไม่ mount อะไรเกินจำเป็น |
| ไม่มี @mention ในกลุ่ม → เผาโควตา | `LINE_ALLOWED_GROUPS` แคบไว้ก่อน |
| ทุกคนในกลุ่มเห็นบริบทเดียวกัน | อย่าเอาข้อมูลลับเข้ากลุ่ม |
| Push API กินโควตาข้อความ OA | `LINE_SLOW_RESPONSE_THRESHOLD=45` ใช้ปุ่ม postback แทน |
| รันสอง gateway ชี้ `data/` เดียวกัน | ห้ามทำ — session/memory ไม่ concurrent-safe |

## โครงไฟล์

```
bot-service/
├── docker-compose.yml       # hermes (container {{CONTAINER_PREFIX}}-line-bot) + cloudflared
├── .env.example / .env      # .env gitignore ไว้ chmod 600
├── config/
│   ├── config.yaml.tmpl     # template — ของจริงคือ data/config.yaml
│   ├── SOUL.md              # persona (LINE ไม่ render markdown — SOUL.md สั่งไว้)
│   └── skills-keep.txt      # skills ที่ให้ seed
├── scripts/
│   ├── init.sh              # เตรียม data/ + gen config + ตรวจทาง LiteLLM
│   ├── check-chain.sh       # ⭐ chain ยังใช้ได้ไหม + ตรวจโครง (รันทุกวัน)
│   ├── _verdict.py          #    แยก ตายถาวร / ไม่ฟรีแล้ว / โควตาหมด / ช้าเกิน
│   ├── _chain_audit.py      #    ตรวจ pool ซ้ำ + ชื่อไม่มีจริง + สัญญาณเตือน
│   ├── probe-litellm.sh     # คัดโมเดล: tool calling + context
│   ├── probe-thai.sh        # คัดโมเดล: อยู่กับภาษาไหม (ต้องยิงผ่าน Hermes จริง)
│   ├── trim-skills.sh       # ตัด bundled skills
│   └── smoke-webhook.sh     # ยิง webhook ที่เซ็นถูก
└── data/                    # → /opt/data (gitignore) sessions/ memories/ skills/
```

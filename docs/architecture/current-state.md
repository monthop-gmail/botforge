# Botforge — Current State

**Phase 0 Audit** · 2026-08-23
**Source:** `../server-botforge` @ `e56e28e`
**⚠️ แก้ 2026-08-23:** ตอน audit ใช้ checkout ในเครื่องที่ **ตามหลัง `origin/main` อยู่ 4 commit** ปลายจริงของ V1 คือ `5d6d709` (2026-08-11) ไม่ใช่ `e56e28e` (2026-04-18) — ดู §10
**วิธี:** อ่าน source จริงทั้ง repo + วัดความซ้ำด้วย `diff` แบบ pairwise ทุกคู่ ไม่ได้อ่านจากเอกสาร

---

## สรุป 5 ข้อ

1. **Botforge ไม่มี core** — ไม่มี shared library, ไม่มี package, ไม่มี module ที่ถูก import ซ้ำ มีแต่ไฟล์ `src/index.ts` ไฟล์เดียวต่อ bot แล้ว copy ออกไป
2. **โค้ด bot 18,614 บรรทัด แต่เนื้อหาจริงประมาณ 1,000 บรรทัด** — ที่เหลือคือสำเนา
3. **`bot-service-codex` กับ `bot-service-codex-appserver` เหมือนกันทุก byte** — สอง "runtime" ที่ต่างกันแค่ชื่อ
4. **14 projects ที่ deploy อยู่จริง แต่ละตัวต่างจาก template แค่ 1 บรรทัด** และแต่ละตัวเป็น git repo แยก
5. **Botforge ไม่อยู่ในทะเบียน ecosystem** — `grep botforge` ใน `agent-platform` ได้ 0 hit และ `ecosystem-intelligence` ระบุชื่อไว้ตรง ๆ ว่ายังไม่นับเข้า registry

---

## 1. Inventory

### 1.1 Control plane — bash 1,645 บรรทัด

| ไฟล์ | บรรทัด | หน้าที่ | คำสั่ง |
| --- | ---: | --- | --- |
| `botforge` | 613 | project generator | `new` `sync` `list` `help` |
| `botforge-deploy` | 823 | multi-bot orchestration + Cloudflare | `up` `down` `restart` `rebuild` `status` `logs` `ps` `pull` `tunnel {init,setup,list,delete}` |
| `botforge-models` | 209 | ดึง model list จาก provider | `--list` + `fetch_{anthropic,openai,google,deepseek,qwen,groq,opencode}` |

ทั้งสามตัวเป็น bash ล้วน ไม่มี test ไม่มี CI

### 1.2 Templates — 10 directory, ใช้ได้จริง 9

| Template | `src/index.ts` | server | มี `.github` | สถานะ |
| --- | ---: | --- | :---: | --- |
| `bot-service-opencode` | 900 | (ใช้ OpenCode serve ภายนอก) | ✓ | ใช้งานจริง — 9 projects |
| `bot-service-claude-code` | 831 | Hono + Agent SDK | ✓ | ใช้งานจริง — 2 projects |
| `bot-service-copilot-cli` | 832 | Hono + Copilot SDK | — | ใช้งานจริง — 1 project |
| `bot-service-adkcode` | 704 | FastAPI + Google ADK | ✓ | ใช้งานจริง — 2 projects |
| `bot-service-gocode` | 689 | Go + chi | ✓ | ไม่มี project ใช้ |
| `bot-service-gemini-cli` | 670 | Hono + Gemini CLI spawn | — | ไม่มี project ใช้ |
| `bot-service-codex` | 662 | Hono + Codex CLI spawn | — | ไม่มี project ใช้ |
| `bot-service-qwen-code` | 662 | Hono + Qwen CLI spawn | — | ไม่มี project ใช้ |
| `bot-service-codex-appserver` | 662 | Hono + Codex App Server WS | — | ไม่มี project ใช้ |
| `bot-service-thaillm` | — | — | — | **ว่างเปล่า** — มีแต่ `src/` ที่ไม่มีไฟล์ |

> `bot-service-thaillm` เป็น scaffold ที่ตายแล้ว งาน Thai LLM จริงลงไปที่ `bot-service-opencode/opencode.json` ใน commit สุดท้าย ไม่ได้ลงที่ template นี้

### 1.3 Projects — 14 ตัว ทุกตัวเป็น git repo แยก

```
opencode   (9)  cowork · dede · hct · legal · mtr · nst · onboard · vithisa-49m · willpower
claudecode (2)  cowork-claudecode · legal-claudecode
adkcode    (2)  legal-adkcode · legal-services
copilot    (1)  legal-copilot
```

ทุกตัวมีครบ: `bot-service/` (git repo แยก) · `docker-compose.yml` · `workspace/`

### 1.4 Workspace template — 3 ไฟล์

```
templates/workspace/
├── AGENTS.md      56 บรรทัด — role, rules, GitHub workflow (มี {{PLACEHOLDER}})
├── README.md
└── docs/.gitkeep
```

> Doc V2 §7 วาดโครงไว้ว่ามี `skills/ knowledge/ memory/ policies/ tools/` — **ของจริงยังไม่มีสักอันเดียว** ที่มีคือ `AGENTS.md` + `README.md` เท่านั้น (`memory-{groupId}.md` ถูกอ่านโดย runtime แต่ไม่มีที่เก็บใน template)

---

## 2. ความซ้ำ — ตัวเลขจาก `diff` ตรง ๆ

### 2.1 Template เทียบ Template

| คู่ | diff-lines | ตีความ |
| --- | ---: | --- |
| `codex` ↔ `codex-appserver` | **0** | **ไฟล์เดียวกันทุก byte** |
| `codex` ↔ `qwen-code` | 26 | เหมือนกัน 98% |
| `codex` ↔ `gemini-cli` | 34 | เหมือนกัน 97% |
| `claude-code` ↔ `copilot-cli` | 41 | เหมือนกัน 97.5% |
| `codex` ↔ `claude-code` | 315 | เหมือนกัน ~80% |
| `opencode` ↔ `gocode` | 637 | เหมือนกัน ~60% (สองตัวนี้เป็นรุ่นเก่า) |

**อ่านได้ว่า:** template 4 ตัว (`codex` `codex-appserver` `qwen-code` `gemini-cli`) คือไฟล์เดียวกันที่เปลี่ยนแค่ปลายทางของ HTTP call

### 2.2 Project เทียบ Template — ตรวจครบทั้ง 14

| Project | เทียบกับ | diff-lines |
| --- | --- | ---: |
| ทั้ง 9 `*-opencode` + `vithisa-49m` | `bot-service-opencode` | **2** (= แก้จริง 1 บรรทัด) |
| `cowork-claudecode` · `legal-claudecode` | `bot-service-claude-code` | 2 |
| `legal-copilot` | `bot-service-copilot-cli` | 2 |
| `legal-adkcode` · `legal-services` | `bot-service-adkcode` | 2 |

**ทั้ง 14 project ไม่มีตัวไหนต่างจาก template เกิน 1 บรรทัด** — บรรทัดนั้นคือชื่อ project

### 2.3 ยอดรวม

```
index.ts ใน templates/            6,612 บรรทัด
index.ts ใน projects/            12,002 บรรทัด
                              ─────────────────
รวม                              18,614 บรรทัด

บรรทัดที่ไม่ซ้ำกันเลย (สอง repo รวมกัน)   1,059 บรรทัด
```

> ตัวเลข 1,059 มาจาก `sort -u` บนบรรทัดที่ trim แล้ว จึงนับ `}` และบรรทัดว่างเป็นหนึ่งเดียว — ใช้เป็น**ตัวชี้ทิศ** ไม่ใช่ตัวเลขที่เอาไปอ้างตรง ๆ หลักฐานที่แข็งจริงคือ §2.1 และ §2.2

**ต้นทุนที่จับต้องได้:** แก้ bug ใน session handling หนึ่งจุด = แก้ 9 template + 14 project = **23 ไฟล์ ใน 15 git repo**

---

## 3. กลไกแจกจ่ายปัจจุบัน — `botforge sync`

`botforge` CLI มี `sync_project()` อยู่แล้ว แบ่ง 2 ระดับ:

```bash
get_sync_files()       # default — infra เท่านั้น
                       #   opencode : Dockerfile.opencode docker-compose.yml opencode.json .env.example
                       #   อื่น ๆ    : server/Dockerfile docker-compose.yml .env.example

get_full_sync_files()  # --full — เพิ่ม src/index.ts + CLAUDE.md + server source
```

**ข้อจำกัดที่เป็นสาระ:**

- เป็นการ **copy ทับ** ไม่ใช่ dependency — ไม่มี version, ไม่มี merge, ไม่มี changelog
- default **ไม่ sync `src/index.ts`** → bug fix ในตัว bot ไม่ไหลลง project เว้นแต่สั่ง `--full`
- `--full` ทับไฟล์ทั้งไฟล์ → ถ้า project เคยแก้เอง จะหายเงียบ ๆ
- ไม่มีอะไรบอกได้ว่า project ไหน sync ค้างอยู่ที่ template รุ่นไหน

> นี่คือเหตุผลที่ทั้ง 14 project ต่างกันแค่ 1 บรรทัด — ไม่ใช่เพราะ template ดีจนไม่ต้องแก้ แต่เพราะกลไกบังคับให้ทุกตัวเหมือนกัน และการแก้เฉพาะที่ทำไม่ได้โดยไม่เสีย sync

---

## 4. โครงสร้างภายใน `src/index.ts` — เหมือนกันทุก template

ทุก template มีชุด function ชุดเดียวกัน เรียงลำดับเดียวกัน ต่างแค่เลขบรรทัด:

| กลุ่ม | Function | ผูกกับ runtime? |
| --- | --- | :---: |
| Logging | `log()` | — |
| **Channel (LINE)** | `validateSignature()` `chunkText()` `sendMessage()` `isBotMentioned()` `getSessionKey()` | — |
| **Channel events** | `handleJoinEvent()` `handleLeaveEvent()` `handleImageMessage()` | — |
| **Context** | `getUserProfile()` `getUserContext()` `getTimeContext()` `getGroupName()` `getGroupMemory()` | — |
| **Session** | `enqueueForSession()` · `interface UserSession` | — |
| **Error** | `getErrorHint()` | — |
| Runtime I/O | `serverRequest()` / `opencodeRequest()` / `gocodeRequest()` / `adkcodeRequest()` | ✅ |
| Runtime I/O | `createSession()` `sendPrompt()` `extractResponse()` `waitForServer()` | ✅ |
| **ผสมกัน** | `handleTextMessage()` — 232–243 บรรทัด | ⚠️ |

**อ่านได้ว่า:**

- ~70% ของทุกไฟล์คือ Channel + Session + Context ที่**ไม่ผูกกับ runtime เลย** → ควรอยู่ใน core
- ส่วนที่ผูกกับ runtime จริงมีแค่ 4–5 function → นี่คือขนาดจริงของ RuntimeAdapter
- `handleTextMessage()` คือจุดที่ทุกอย่างพันกัน: command routing (`/new` `/model` `/abort` …) + group `[SKIP]` + context injection + runtime call + error mapping อยู่ในฟังก์ชันเดียว 240 บรรทัด — **นี่คือ blocker หลักของการแยก layer** ไม่ใช่โครง folder

---

## 5. Feature checklist เทียบของจริง

`bot-feature-checklist.md` (181 บรรทัด) แจง 81 feature ใน 12 หมวด — เป็น **template เปล่าสำหรับ audit** ช่อง Status ว่างทั้งหมด และท้ายไฟล์ยังเป็น `Audited by: _____`

> ตัวเลข "81 feature" ใน doc V2 §1 จึงเป็น **จำนวนช่องในตาราง ไม่ใช่จำนวน feature ที่ verify แล้ว** — ยังไม่เคยมีใครกรอก

หมวดที่ checklist เองระบุว่า **ไม่ครบทุก engine**: `/cost` (2.10, 5.6) เฉพาะ claude-code/copilot-cli · group memory (4.4, 4.5) เฉพาะ claude-code · `.mcp.json` (11.4) เฉพาะ claude-code/copilot-cli · credential mount (10.3–10.5) ต่างกันทุก engine

---

## 6. ตำแหน่งใน ecosystem — ยังไม่มี

| หลักฐาน | ผล |
| --- | --- |
| `grep -ri botforge` ใน `poc-agent-platform` | **0 hit** |
| แถวใน `architecture/consumers.md` | **ไม่มี** |
| `platform-contract.yaml` | **ไม่มี** |
| `conformance/` | **ไม่มี** |
| `ecosystem-intelligence/docs/entities.md:140` | ระบุชื่อ `botforge` ไว้ตรง ๆ ว่ายังไม่นับเข้า registry จนกว่าจะมี component |

เทียบกับ repo อื่นในตระกูลเดียวกัน:

| Repo | commit ล่าสุด | `platform-contract.yaml` | conformance CI |
| --- | --- | :---: | :---: |
| `poc-agent-platform` | 2026-08-22 | (เป็นเจ้าของ contract) | ✓ |
| `devfactory-core` | 2026-08-22 | ✓ passing | ✓ |
| `ecosystem-intelligence` | 2026-08-22 | ✓ passing | ✓ |
| `care-agent-platform` | 2026-08-22 | ✓ passing | ✓ |
| `enterprise-knowledge` | 2026-08-21 | ✗ | ✗ |
| **`server-botforge`** | **2026-08-11** | **✗** | **✗** |

~~Botforge นิ่งมา **4 เดือน**~~ — **ผิด** · Botforge ขยับล่าสุด 2026-08-11 ห่างจาก repo อื่นแค่วันเดียว ข้อสรุปที่ยังจริงคือ **ยังไม่มี `platform-contract.yaml` และ conformance** ไม่ใช่ว่าไม่มีคนดูแล

---

## 7. ความเสี่ยงที่เจอระหว่าง audit

| # | เรื่อง | ผล |
| --- | --- | --- |
| R1 | ไม่มี test เลยทั้ง repo | refactor ใด ๆ ไม่มีตาข่ายรอง — ขัดกับข้อ "Preserve behavior" ของ doc V2 โดยตรง |
| R2 | ไม่มี CI ที่ตรวจอะไรจริง | `server-botforge` เองไม่มี `.github/workflows/` เลย (มีแต่ ISSUE_TEMPLATE + PULL_REQUEST_TEMPLATE) · 4 template (`opencode` `claude-code` `gocode` `adkcode`) ship `ci.yml` ให้ project ที่ generate ออกไป แต่ workflow นั้นทำแค่เช็คว่า PR มี linked issue แล้ว `echo "CI passed!"` — **ไม่มี build ไม่มี test ไม่มี typecheck** ไม่มีอะไรกันไม่ให้ 23 สำเนาแยกจากกัน |
| R3 | `codex` = `codex-appserver` ทุก byte | มี engine ปลอมอยู่ใน matrix — CLAUDE.md โฆษณา 9 engine แต่ของจริงแตกต่างกัน ~6 |
| R4 | `bot-service-thaillm` ว่างเปล่า | `botforge new` เลือกได้แต่จะพัง |
| R5 | 14 project เป็น git repo แยก | การอัป V2 = แตะ 15 repo ไม่ใช่ repo เดียว |
| R7 | `chunkText()` วนไม่จบได้ | เมื่อ `limit` เล็กพอที่จุดตัดสั้นกว่า 4 ตัวอักษร และ chunk มี code fence เป็นเลขคี่ — เติม `"```\n"` กลับเข้า `remaining` มากกว่าที่ตัดออก · **production ใช้ `limit=5000` จึงไม่เคยเจอ** (จุดตัดสั้นสุด 1,500 ตัว) แต่ `limit` เป็น parameter · แก้แล้วใน `@botforge/core` ด้วย progress guard |
| R6 | secret อยู่ใน `.env` ต่อ project | ยังไม่ได้ audit ว่ามี credential รั่วใน git history ของ 14 repo ไหม — **ควรตรวจก่อนเปิด repo ใด ๆ เป็น public** |

---

## 8. คำถามที่ต้องตัดสินใจก่อน Phase 1

| # | คำถาม | ทำไมต้องตอบก่อน |
| --- | --- | --- |
| Q1 | V2 เป็น repo ใหม่ หรือ branch ของ `server-botforge`? | ถ้าแยก repo → deployment ของ 14 bot fork ตาม และ `botforge-deploy` ต้องรู้จักสองโลก |
| Q2 | 14 bot ที่รันอยู่ขึ้น V2 ยังไง — regenerate / freeze ที่ V1 / consume package แบบมี version? | กำหนดว่า `@botforge/core` ต้อง backward-compatible แค่ไหน |
| Q3 | ยุบ `codex-appserver` `qwen-code` `gemini-cli` เข้า adapter เดียวไหม? | ถ้ายุบ engine matrix เหลือ ~6 — งาน extract เล็กลงครึ่งหนึ่ง |
| Q4 | `bot-service-thaillm` ลบ หรือทำให้เสร็จ? | ค้างอยู่ใน `botforge new` |
| Q5 | Botforge เป็น consumer ของ `agent-platform` หรือแค่ align ศัพท์? | ถ้าเป็น consumer ต้องทำครบ 3 ข้อของ ADR-0006 (manifest + payload conformance + release gate) |

---

## 9. ข้อสรุปที่ส่งผลต่อแผน V2

Doc V2 Phase 2 วางโครง `core/ agents/ sessions/ workspace/ runtime/ channels/ models/ deployment/` ไว้ — โครงนี้**ถูก** แต่ Phase 2 แบบนั้นสมมติว่ามี codebase ให้จัดใหม่

ของจริงคือ template หนึ่งชุดกับสำเนาของมัน 23 ชุด **จึงต้องมีขั้น de-duplicate ก่อน** ไม่งั้น contract ที่เขียนจะเป็นเอกสารเฉย ๆ เพราะ Definition of Done ข้อ "เปลี่ยน Codex → Claude โดยไม่แก้ Channel" เป็นไปไม่ได้ตราบใดที่ Channel logic ถูก copy อยู่ 23 ที่

รายละเอียดขอบเขตที่เสนอให้ดึงออกมา อยู่ที่ [`component-map.md`](component-map.md)


---

## 10. แก้ข้อมูลที่ผิด — 2026-08-23

ตอนทำ Phase 0 ผมอ่านจาก checkout ในเครื่องที่ `git fetch` ค้างไว้ตั้งแต่ เม.ย. จึงพลาดไป 4 commit

```
audit baseline   e56e28e  2026-04-18
v1-final จริง     5d6d709  2026-08-11   ← tag ชี้ที่นี่แล้ว
```

### 4 commit ที่พลาดไปทำอะไร

| commit | เนื้อหา |
| --- | --- |
| `9dd7cf4` | เปิด tool calling ให้ Typhoon-S และ THaLLE |
| `38a0ff1` | เพิ่ม provider **OKMD AI Playground** — 23 model ผ่าน key เดียว |
| `eb42bca` | เพิ่ม okmd เข้า `botforge-models` |
| `5d6d709` | thaillm drift check ใน `botforge-models` + fix anthropic fetch |

แตะ `botforge-models` และ `templates/bot-service-opencode/` เท่านั้น — ไม่แตะ engine อื่นเลย

### อะไรเปลี่ยน อะไรไม่เปลี่ยน

| ข้อสรุปใน audit | สถานะ |
| --- | :-: |
| `codex` = `codex-appserver` เหมือนกันทุก byte | ✅ ยังจริง |
| `bot-service-thaillm` ว่างเปล่า | ✅ ยังจริง |
| `getErrorHint()` เหมือนกันทุก byte ทั้ง 8 engine | ✅ ยังจริง |
| บรรทัดของ 8 engine (claude-code 831 · codex 662 · …) | ✅ ยังจริง |
| **`opencode` 900 บรรทัด** | ❌ **ตอนนี้ 941** |
| **"นิ่งมา 4 เดือน"** | ❌ **ผิด — ขยับล่าสุด 2026-08-11** |

### สิ่งที่ค้นพบเพิ่มเพราะเรื่องนี้ — **14 bot ตามหลัง template แล้ว**

```
templates/bot-service-opencode   941 บรรทัด  (2026-08-11)
projects/*/bot-service           900 บรรทัด  (รุ่น เม.ย.)  ต่างกัน 63 diff-lines
```

ตอน audit วัดได้ว่า project ต่างจาก template แค่ 1 บรรทัด — **ตอนนี้ 63** เพราะ template ขยับแต่ไม่มีใครรัน `botforge sync --full`

นี่คือกลไกใน §3 ที่ทำงานตามที่คาดพอดี: default ของ `botforge sync` **ไม่ sync `src/index.ts`** bug fix และ feature ใหม่จึงไม่ไหลลง bot ที่รันอยู่ · 14 bot ยังไม่ได้ OKMD provider, ไม่ได้ตัว `stripStrayToolCalls()` และไม่ได้ข้อความแจ้งโควต้าหมดของ OKMD

**ไม่กระทบข้อสรุปหลักของ V2** — ยิ่งยืนยันว่าการแจกจ่ายด้วยการ copy ทับคือปัญหาจริง

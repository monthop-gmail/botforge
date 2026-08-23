# Open Items

**2026-08-23** · รายการเดียวที่รวมทุกอย่างที่ยังค้าง — รวบรวมจากrepo จริง ไม่ใช่จากความจำ

---

## 🔴 ช่องว่างที่ใหญ่ที่สุด — V2 ยังส่งมอบอะไรไม่ได้

มี library ครบแล้ว **แต่ไม่มีอะไรประกอบเป็น bot ที่ deploy ได้**

| | สถานะ |
| --- | --- |
| `packages/` — core + adapter 4 + channel-web | ✅ 222 test |
| **LINE webhook server** | ❌ **ไม่มีใน V2 เลย** — มีแต่ primitive ใน `core/channel/line.ts` |
| `apps/` — ตัวที่ประกอบ core + adapter + channel เป็น service | ❌ ไม่มี |
| template ให้ `botforge new` ที่ใช้ `@botforge/core` | ❌ ไม่มี |
| bot 14 ตัวที่ลูกค้าใช้อยู่ | ยังเป็น V1 ทั้งหมด · **ตามหลัง template ของตัวเอง 63 diff-lines** |

`scripts/web-demo.ts` และ `smoke-*.ts` เป็น **script สาธิต ไม่ใช่ service**

**ผลคือ:** `channel-web` มี HTTP server เต็มตัว แต่ **LINE ซึ่งเป็น channel ของทั้ง 14 bot ยังไม่มี server ใน V2**
งานที่ทำมาทั้งหมดยังไม่ถึงมือผู้ใช้จริงสักคน

> ถ้าจะทำต่ออย่างเดียว ควรเป็นอันนี้ — `channel-line` แล้วต่อด้วย `apps/line-bot`

---

## ปิดไปแล้ว

| # | | หลักฐาน |
| --- | --- | --- |
| R1 | ไม่มี test เลยทั้ง repo | 222 test · characterization test เทียบ v1 verbatim |
| R2 | ไม่มี CI ที่ตรวจอะไรจริง | CI 2 job + ruleset `bypass_actors: 0` ทั้ง `main` และ `v2` |
| R4 | `bot-service-thaillm` ว่างเปล่า | ไม่มีใน git (git ไม่ track dir ว่าง) · `botforge new` ไม่เคยเสนอ — **ไม่มีอะไรต้องลบ** |
| R7 | `chunkText()` วนไม่จบได้ | progress guard + test ที่ limit 5–13 |
| A1 | กรอก checklist 81 ข้อ | [`feature-matrix.md`](feature-matrix.md) |
| **R6 / A3** | **credential รั่วใน 14 project repo** | **ตรวจแล้ว 2026-08-23 — ดูข้างล่าง** |

### R6 / A3 — ผลตรวจ credential

```
สแกน 14 repo · พบปัญหา 0
```

| ตรวจอะไร | ผล |
| --- | --- |
| git remote | **ไม่มีสักตัว** — เป็น local repo ล้วน ไม่เคย push ขึ้น GitHub |
| จำนวน commit | 1 commit ต่อ repo |
| ชื่อไฟล์ใน history (`.env` · `credential` · `.pem` · `.key`) | ไม่พบ |
| เนื้อไฟล์ใน history (`sk-*` · `ghp_*` · `xox*` · `AKIA*` · PRIVATE KEY) | ไม่พบ |
| `.env` จริง 14 ไฟล์ | อยู่นอก git · `.gitignore` ครอบ |

**ความเสี่ยงต่ำกว่าที่ประเมินไว้มาก** — ตอน audit ผมเขียนว่า *"ควรตรวจก่อนเปิด repo เป็น public"*
โดยอ้างอิงจาก `templates/workspace/AGENTS.md` ที่เขียนว่า `(Public)`
แต่นั่นเป็นข้อความใน template ที่บรรยายความตั้งใจ — **ของจริงไม่มี repo ไหนถูก push เลย**

> ⚠️ รอบแรกที่รันสแกนเนื้อไฟล์ **path ผิดแล้วล้มเงียบ** จนขึ้น `✓` ทั้งที่ไม่ได้สแกนอะไรเลย
> รันใหม่แล้วนับจำนวน repo ที่สแกนจริงมายืนยัน — ตัวเลข 14 ข้างบนมาจากรอบที่สอง

---

## ยังค้าง — เรียงตามผลกระทบ

### 1. ส่งมอบไม่ได้ (ดูข้างบน) 🔴

### 2. R5 — bot 14 ตัวตามหลัง template แล้ว 🟠

`template 941 บรรทัด` · `projects/* 900 บรรทัด` · ต่างกัน **63 diff-lines**
ไม่มีใครรัน `botforge sync --full` หลัง commit เดือน ส.ค. → 14 bot ยังไม่ได้ OKMD provider ·
`stripStrayToolCalls()` · ข้อความแจ้งโควต้าหมด

เป็นคนละเรื่องกับ V2 — **แก้ได้เลยวันนี้บน `main`** ถ้าอยากให้ลูกค้าได้ของ

### 3. R3 — `botforge new` ยังเสนอ engine ที่ซ้ำกัน 🟡

`codex` กับ `codex-appserver` เหมือนกันทุก byte ฝั่ง bot · CLI ยังอ้าง `codex-appserver` **8 จุด**
adapter ยุบแล้วแต่ template ยังไม่ยุบ

### 4. A2 — ยังไม่เคย audit `server/` ของแต่ละ engine 🟡

~6,000 บรรทัด TS/Go/Python · audit ทั้งหมดเจาะที่ `src/index.ts` เป็นหลัก
adapter ที่เขียนไปแล้ว 4 ตัวได้อ่าน `server/` ของตัวเองบ้างแล้ว แต่ไม่ครบและไม่เป็นระบบ

### 5. A4 — contract mapping §5 ยังเป็นร่าง 🟡

verify ราย field แล้วเฉพาะ `error/v1` · `event/v1` · `identity/v1` (ที่ประกาศใน manifest)
ที่เหลือ 12 ตระกูลยังไม่ได้ลงราย field

---

## ค้างในแต่ละ package

| package | ค้าง |
| --- | --- |
| `adapter-opencode` | ยิง model จริงแล้ว ✅ · ไม่มีค้าง |
| `adapter-codex` | **ยังไม่เคยยิง `codex app-server` ตัวจริง** — ไม่มี CLI ในเครื่อง |
| `adapter-claude` | **ยังไม่เคยยิง SDK ตัวจริง** — ไม่มี API key · streaming · map `maxTurns`/`maxBudgetUsd` เป็น `error/v1` |
| `adapter-adkcode` | **ยังไม่เคยยิงตัวจริง** — ต้องมี Google ADC · **sub-agent execution tree** รอ `api.py` ส่ง `author` ออกมา |
| `channel-web` | reconnect / `Last-Event-ID` · **ตัวตนผู้ใช้** (`actor` ยังไม่มี — ทุกคนในห้องคือคนเดียวกัน) · streaming ทีละ token |
| `core` | streaming · `/cost` command · MCP registry |

**adapter 3 ใน 4 ยังไม่เคยคุยกับของจริง** — ทั้งหมดพิสูจน์ด้วย fake ที่พูด protocol เดียวกัน
ซึ่งจับ bug ได้จริง (เช่น `turn/completed` ค้างของ codex) แต่ไม่เท่ากับของจริง

---

## พักไว้ตามที่ตกลง

`copilot-cli` (41 diff-lines จาก `claude-code`) · `gocode` (0 project ใช้) ·
`qwen-code` (รอ `qwen serve` ออกจาก experimental) · `gemini-cli` (รอ PR daemon merge)

---

## Phase เทียบกับแผนเดิม

| Phase | |
| --- | :-: |
| 0 Audit | ✅ |
| 0.5 conformance + CI | ✅ ADR-0006 ครบ 3 ข้อ · อยู่ในทะเบียนแล้ว |
| 1 Contract mapping | ✅ (A4 ยังเหลือรายละเอียด) |
| 1.5 De-duplicate | ✅ |
| 2 จัดโครง repo | ✅ โดยพฤตินัย — `packages/` แทนโครง `core/ agents/ sessions/` ที่ doc เดิมวางไว้ |
| 3 RuntimeAdapter | 🚧 4/9 · ที่เหลือพักไว้ |
| 4 Agent Platform runtime | ⬜ ยังไม่เริ่ม — `agent-backend-os` ยังไม่มี repo |
| 5 Multi-channel | 🚧 web ✅ · **line ยังไม่มี** · telegram/discord ⬜ |

> **Phase 5 ย้อนแย้ง** — เรามี channel ที่สองก่อนมี channel ที่หนึ่ง

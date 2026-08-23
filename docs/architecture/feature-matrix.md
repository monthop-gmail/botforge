# Botforge — Feature Matrix

**A1 · Phase 0 Audit** · 2026-08-23
**Source:** `../server-botforge` @ `e56e28e`
**⚠️ baseline นี้ตามหลัง `v1-final` (`5d6d709`) อยู่ 4 commit** — ดู [`current-state.md`](current-state.md) §10
ผลกระทบต่อตารางนี้: เฉพาะ `opencode` (900 → 941 บรรทัด · เพิ่ม OKMD provider · `stripStrayToolCalls`)
อีก 8 engine ไม่ถูกแตะเลย · ข้อสรุปทุกข้อในตารางยังจริง
**วิธี:** ตรวจ 81 ข้อของ [`bot-feature-checklist.md`](../../bot-feature-checklist.md) กับ source จริงทีละ engine ด้วย `grep` แล้ว**เปิดอ่าน context ทุกข้อที่ผลกำกวม** — ไม่ได้เชื่อ grep เปล่า ๆ

> `bot-feature-checklist.md` ในrepo ยังเป็นแบบฟอร์มเปล่า ช่อง Status ว่างทั้ง 81 ช่อง ตารางนี้คือการกรอกครั้งแรก

**สัญลักษณ์:** `✅` มี · `❌` ไม่มี · `⚠️` มีแต่ต่างจากที่ checklist บรรยาย · `—` ไม่เกี่ยว (N/A)

**Engine:** `OC` opencode · `CC` claude-code · `CP` copilot-cli · `AD` adkcode · `GO` gocode · `CX` codex · `CA` codex-appserver · `QW` qwen-code · `GM` gemini-cli

> `CX` `CA` `QW` `GM` ให้ผลเหมือนกันทุกข้อ — สอดคล้องกับที่ `current-state.md` วัดไว้ว่าไฟล์ต่างกัน 0–34 บรรทัด

---

## คะแนนรวม

| Engine | ✅ | ⚠️ | ❌ | project ที่ใช้จริง |
| --- | ---: | ---: | ---: | ---: |
| `claude-code` | **64** | 1 | 16 | 2 |
| `copilot-cli` | **63** | 1 | 17 | 1 |
| `opencode` | 59 | 1 | 21 | **9** |
| `codex` · `codex-appserver` · `qwen-code` · `gemini-cli` | 53 | 0 | 28 | 0 |
| `adkcode` | 53 | 1 | 27 | 2 |
| `gocode` | 53 | 0 | 28 | 0 |

**ไม่มี engine ไหนได้ 81** — สูงสุดคือ `claude-code` ที่ 64

**ข้อที่ไม่มีสักengine เดียว: 8 ข้อ** → 4.5 · 11.1 · 11.2 · 11.3 · 12.1 · 12.2 (และ 11.4 มีแค่กลไก)

---

## 1. Bot Commands (8)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 1.1 | `/new` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.2 | `/abort` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.3 | `/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.4 | `/model` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 1.5 | `/model` partial match | ✅ | ✅ | ✅ | — | — | — |
| 1.6 | `/about` · `/who` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.7 | `/help` · `/คำสั่ง` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.8 | `/cost` | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |

**1.5 มีสองความหมายที่ไม่เหมือนกัน** — `opencode` ใช้ `k.endsWith("/" + arg)` (ต้องตรงท้ายหลัง `/`) ส่วน `claude-code`/`copilot-cli` ใช้ `k.includes(arg)` (substring ที่ไหนก็ได้) พิมพ์คำเดียวกันได้คนละผลลัพธ์ — ต้องเลือกอันเดียวตอนทำ core

---

## 2. AI / Session Management (12)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 2.1 | Multi-provider models | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 2.2 | `MODELS` map | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 2.3 | Default model | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 2.4 | `modelPrefs` per session | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 2.5 | Session per group/user | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.6 | Auto-retry on 404 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.7 | Prompt timeout + Abort | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.8 | Partial response on timeout | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 2.9 | Question tool prevention | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 2.10 | Per-session cost tracking | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 2.11 | **Per-session request queue** | **❌** | ✅ | ✅ | **❌** | **❌** | ✅ |
| 2.12 | Model reset on switch | ✅ | ✅ | ✅ | — | — | — |

**2.11 คือข้อที่น่ากังวลที่สุดในตารางทั้งหมด** — `enqueueForSession()` คือกลไกกัน race condition เวลามีหลายคนในกลุ่มพิมพ์พร้อมกัน **`opencode` ไม่มี** และ `opencode` คือ engine ของ **9 ใน 14 bot ที่รันจริง** ส่วน engine ที่มี queue ครบ (`codex` family) กลับไม่มี project ใช้เลยสักตัว

---

## 3. LINE Integration (11)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 3.1 | Signature validation (HMAC) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.2 | `replyMessage` first | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.3 | `pushMessage` retry on 429 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.4 | Message chunking (5000) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.5 | Code block balancing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.6 | Loading animation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.7 | Image handling | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.8 | Join event | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.9 | Leave event | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.10 | Bot mention detection | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.11 | `LINE_OA_URL` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**หมวดเดียวที่ครบ 100% ทุก engine** — ยืนยันว่า Channel layer คือส่วนที่ mature ที่สุดและ**พร้อมดึงเข้า core มากที่สุด**

---

## 4. Group Chat (7)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 4.1 | Shared session per group | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.2 | `[SKIP]` detection | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.3 | Group name context | **❌** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.4 | Group memory injection | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 4.5 | **Session-only injection** | **❌** | **❌** | **❌** | **❌** | **❌** | **❌** |
| 4.6 | Group member profile | **❌** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4.7 | `GROUP CHAT` instruction | ✅ | ✅ | ✅ | **❌** | ✅ | ✅ |

**4.5 ไม่มีที่ไหนเลย** — checklist บรรยายว่า "inject memory เฉพาะ new session (ไม่ทุกข้อความ)" แต่ `claude-code` เรียก `getGroupMemory()` ที่บรรทัด 626 ซึ่งอยู่ใน per-message path คือ**อ่านไฟล์ memory ใหม่ทุกข้อความ** ข้อนี้เป็นความตั้งใจที่ไม่เคยถูก implement

**`opencode` ไม่มี group context เลย** (4.3 + 4.6) — ไม่มี `getGroupName()` และไม่มี `getGroupMemberProfile()` ในไฟล์

---

## 5. Context Enrichment (7)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 5.1 | User profile caching | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.2 | User context | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.3 | Time context (Bangkok) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.4 | Reply/Quote context | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.5 | Group info context | **❌** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5.6 | Cost in response | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 5.7 | User message count | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**5.2 `opencode` ใช้คนละ format** — `[User Info: {name} (messages: {n})]` ส่วนที่เหลือใช้ `[User: {name}]` prompt ที่ AI เห็นจึงไม่เหมือนกันข้าม engine ทั้งที่ควรเป็น context เดียวกัน

---

## 6. Error Handling (6)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 6.1 | API error extraction | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 6.2 | **Error hints (Thai)** | **❌** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6.3 | Timeout message | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6.4 | Truncated response | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6.5 | Session create failure | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6.6 | `replyMessage` fallback | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**6.1 กับ 6.2 เป็นสองสำนักที่ไม่คุยกัน** — `opencode` เลือกทาง `extractResponse()` อ่าน `result.info.error` แล้วส่ง `❌ API Error: {errMsg}` **ดิบ ๆ ให้ผู้ใช้เห็น** ไม่มี `getErrorHint()` ขณะที่อีก 8 engine map error เป็นข้อความไทย 5 แบบ (rate limit / timeout / auth / 500 / context ยาวเกิน)

ผลจริง: bot 9 ตัวที่ลูกค้าใช้อยู่ ได้ error UX แย่ที่สุดในบรรดา engine ทั้งหมด

---

## 7. Response Parsing (5)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 7.1 | Text parts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7.2 | Tool question parts | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 7.3 | Reasoning fallback | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 7.4 | Empty response message | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 7.5 | `is_error` flag | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

`opencode` เป็นเจ้าเดียวที่ parse `parts[]` จริง (text / reasoning / tool question + `stripThinkTags`) — ส่วน `gocode`/`adkcode` เหลือ `result?.result` แค่ 8 บรรทัด

> ตอนยุบ engine ตาม Q3 **`extractResponse()` ต้องยกของ `opencode` มาเป็นฐาน** ไม่ใช่ของที่สั้นกว่า

---

## 8. Web Routes (3)

| # | Route | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 8.1 | `GET /` health | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.2 | `GET /about` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8.3 | `POST /webhook` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 9. Infrastructure (11)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 9.1 | 3-container pattern | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.2 | Server REST client + auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.3 | Wait for server on startup | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 9.4 | Named tunnel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.5 | Logging (Bangkok TZ) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.6 | `text.trim()` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.7 | Server auth password | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.8 | `getBotInfo()` at startup | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.9 | `depends_on` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.10 | Named container prefix | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 9.11 | Workspace volume mount | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**9.3 แบ่งตาม generation พอดี** — Gen 1 (`opencode` `adkcode` `gocode`) มี `waitForServer()` ส่วน Gen 2 ไม่มี พึ่ง `depends_on` อย่างเดียว ซึ่งรับประกันแค่ว่า container **start** แล้ว ไม่ได้แปลว่า server **พร้อมรับ request**

---

## 10. Auth & Credentials (5)

| # | Feature | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 10.1 | API key env | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| 10.2 | OAuth credential mount | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| 10.3 | `gh` CLI OAuth mount | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 10.4 | Google ADC mount | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 10.5 | Selective credential mount | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

หมวดนี้**ควรต่างกันโดยธรรมชาติ** — แต่ละ provider มีวิธี auth ของตัวเอง เป็น config ของ adapter ไม่ใช่ของ core

---

## 11. MCP Tools (4)

| # | MCP Server | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 11.1 | context7 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 11.2 | gh_grep | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 11.3 | brave-search | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 11.4 | Custom MCP via `.mcp.json` | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ |

**หมวดนี้ไม่มีอยู่จริงใน repo**

- `grep -ril "context7\|gh_grep\|brave"` ทั้ง repo → **เจอที่เดียวคือ `bot-feature-checklist.md`** ไม่มีในโค้ดหรือ config ใด ๆ
- **ไม่มีไฟล์ `.mcp.json` อยู่ในrepo เลยสักไฟล์**
- `templates/bot-service-opencode/opencode.json` มีแต่ key `provider` (anthropic, deepseek, google, groq, openai, qwen, openthaigpt, pathumma, thalle) — **ไม่มี key mcp**
- ⚠️ ของ `claude-code`/`copilot-cli`/`adkcode` = **มีกลไกอ่าน แต่ไม่มีของให้อ่าน** — `server/src/claude.ts:24` และ `server/src/copilot.ts:24` `readFileSync(join(workspaceDir, ".mcp.json"))` และ `adkcode/mcp_config.py` โหลด `mcp.json` ถ้ามี แต่ไม่มี template ไหน ship ไฟล์นั้นมา

---

## 12. Workspace Skills (2)

| # | Skill | OC | CC | CP | AD | GO | CX/CA/QW/GM |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 12.1 | `/new-prj` (`skill-new-prj.md`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 12.2 | `/today` (`skill-today.md`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**ไม่มีไฟล์ `skill-*.md` ในrepo** (ที่ `find` เจอคือ `bot-service-adkcode/server/plugins/data/skills/.../skill-template.md` ซึ่งเป็นคนละเรื่อง)

`templates/workspace/` มี 3 ไฟล์: `AGENTS.md` · `README.md` · `docs/.gitkeep`

---

## ข้อสรุป

### 1. checklist อ้างอิง codebase ที่ไม่ได้อยู่ในrepo นี้

หัวไฟล์เขียนว่า *"อ้างอิงจาก **opencode-line** และ **oc-line-claude** เป็น baseline (feature-complete)"* — สองชื่อนี้เป็น repo ภายนอก และ `.gitignore` ของ `server-botforge` เองก็ระบุไว้ว่า:

```gitignore
# Cloned reference repos (not part of botforge)
oc-line-claude/
workspace-cowork-opencode/
```

**81 ข้อจึงบรรยาย repo อื่น** ที่ template ในrepo นี้ไม่เคยไล่ให้ทัน — อธิบายทั้งหมวด 11, 12 ที่หายไปเกลี้ยง และ 4.3/4.6/6.2 ที่ `opencode` ไม่มี

> ตัวเลข "81 features" ใน architecture doc จึงเป็น**เป้าหมาย ไม่ใช่สถานะ** ที่มีจริงสูงสุดคือ 64

### 2. ไม่มี engine ไหนเป็น superset ของ engine อื่น

| ของดีที่มีเจ้าเดียว | อยู่ที่ |
| --- | --- |
| multi-provider · partial-response-on-timeout · `parts[]` parsing เต็ม · `stripThinkTags` | `opencode` |
| cost tracking · group memory | `claude-code` `copilot-cli` |
| request queue | ทุกตัวยกเว้น `opencode` `adkcode` `gocode` |
| error hints ไทย | ทุกตัว**ยกเว้น** `opencode` |

**การยุบ engine ตาม Q3 จึงไม่ใช่ "เลือกตัวที่ดีที่สุดแล้วทิ้งที่เหลือ"** แต่ต้องเก็บของดีจากหลายตัวมารวม ถ้าเลือกผิดจะ regress ของที่ใช้งานอยู่

### 3. engine ที่ deploy เยอะที่สุดคือ engine ที่มีช่องโหว่เยอะที่สุด

`opencode` = 9 ใน 14 bot แต่**ขาด request queue (2.11), error hints ไทย (6.2), group context (4.3/4.6)**

ทั้งสามข้อนี้กระทบผู้ใช้จริงทุกวัน ไม่ใช่เรื่อง architecture — และเป็นเหตุผลที่ดีที่สุดว่าทำไม V2 ถึงคุ้มค่า

> **ขัดกับ Q2 (freeze) หรือไม่:** ไม่ขัด — freeze แปลว่าไม่เอา feature ใหม่ลง V1 ไม่ได้แปลว่าห้ามแก้ ถ้า 2.11 ทำให้ข้อความหายจริงในกลุ่มที่คนพิมพ์พร้อมกัน ควรพิจารณาเป็น fix บน `main` แยกจากงาน V2 — **ต้องยืนยันอาการจาก production ก่อน ยังไม่ได้ตรวจ**

### 4. หมวดที่พร้อมเข้า core ทันที

| หมวด | สถานะ | ท่าที |
| --- | --- | --- |
| 3. LINE Integration (11) | ✅ ครบทุก engine | **ยกเข้า core ได้เลย** — ไม่มีอะไรต้องตัดสินใจ |
| 8. Web Routes (3) | ✅ ครบทุก engine | ยกเข้า core ได้เลย |
| 9. Infrastructure (11) | ✅ 10/11 · เหลือ 9.3 | core ควรบังคับ `waitForServer()` ให้ทุก adapter |
| 5. Context (7) | ✅ เกือบครบ · 5.2 format ต่าง | เลือก format เดียว แล้วยกเข้า core |
| 6. Error (6) | สองสำนัก | core ต้องเป็น error **object** (`error/v1`) แล้ว render ไทยที่ channel |
| 2. Session (12) | กระจัดกระจาย | งานหนักที่สุด — 2.11 ต้องเป็น default ของ core ไม่ใช่ทางเลือก |
| 11. MCP (4) · 12. Skills (2) | ไม่มีอยู่จริง | **เป็นงานใหม่ ไม่ใช่งาน migrate** — ต้องแยกออกจาก scope "preserve behavior" |

### 5. ผลต่อ contract mapping (Phase 1)

- **หมวด 11 (MCP)** — ตั้งใจจะ map ไป `mcp/v1` ของ agent-platform แต่ **ไม่มี behavior เดิมให้ preserve** จึงเป็นการ implement ใหม่ตาม contract ตั้งแต่ต้น ซึ่งง่ายกว่า migrate
- **หมวด 6 (Error)** — `getErrorHint()` คืน string ไทย 5 แบบ ตรงกับ taxonomy ของ `error/v1` พอดี (rate limit / timeout / auth / server / context) เป็นจุดเริ่มที่ดีที่สุดสำหรับ conformance ใบแรก
- **หมวด 2 (Session)** — `session_id` + user + group + model pref มีอยู่แล้ว แต่ยังไม่มี tenant/principal ตาม `identity/v1` เป็นช่องว่างที่ต้องออกแบบ

---

## ยังไม่ได้ตรวจ

| # | เรื่อง |
| --- | --- |
| A2 | `server/` ของแต่ละ engine (~6,000 บรรทัด TS/Go/Python) — ตารางนี้ตรวจ `src/index.ts` เป็นหลัก แตะ `server/` เฉพาะข้อ 11.4 |
| — | 14 project จริง — ถือว่าเท่ากับ template ตามที่ `current-state.md` §2.2 วัดไว้ (ต่างกัน 1 บรรทัด) |
| — | อาการ race condition จาก 2.11 ใน production |

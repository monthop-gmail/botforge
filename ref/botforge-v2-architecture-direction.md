# Botforge V2 — Architecture Direction

## 1. เป้าหมาย

**ไม่ rewrite Botforge**

Botforge เดิมมีของสำคัญอยู่แล้ว ได้แก่

* Multi-runtime
* Session management
* Model management
* LINE integration
* Group context
* Workspace / `AGENTS.md`
* MCP
* Project templates
* Docker deployment
* Cloudflare Tunnel
* CLI สำหรับจัดการหลาย bot

Feature checklist ปัจจุบันสะท้อนว่าระบบมีความสามารถถึงประมาณ 81 รายการ ครอบคลุม Bot Commands, Session, LINE, Group Chat, Context, Error Handling, Infrastructure, Credentials, MCP และ Workspace Skills

ดังนั้นเป้าหมายของ V2 คือ

> **Evolve Botforge จาก LINE Bot Factory → Agent Bot Factory**

และทำให้สามารถเชื่อมกับ `agent-platform` และ `devfactory-core` ผ่าน contract ที่ชัดเจน

---

# 2. ภาพรวม Ecosystem

```text
                         AI / Agent Ecosystem
                                  │
              ┌───────────────────┼──────────────────┐
              │                   │                  │
       agent-platform       devfactory-core       botforge
              │                   │                  │
       Agent Runtime          Factory /           Agent Bot
       Agent Contract         Delivery             Factory
       Policy                Multi Repo            Channel
       Execution             Orchestration         Session
                                                   Workspace
                                                   Runtime
                                                   Deploy
```

บทบาทไม่ควรทับกัน

### agent-platform

> **ทำให้ Agent ทำงาน**

รับผิดชอบ:

```text
Agent
Runtime
Execution
Session semantics
Policy
Tools
Events
Capabilities
```

### devfactory-core

> **ทำให้ Software/Agent Project ถูกสร้างและส่งมอบ**

รับผิดชอบ:

```text
Factory
Project
Repository
Issue
Delivery
Conformance
Orchestration
Multi-repo
```

### botforge

> **ทำให้ Agent ถูกนำไปใช้งานเป็น Bot/Assistant จริง**

รับผิดชอบ:

```text
Bot
Channel
Session
Workspace
Runtime Adapter
Bot UX
Deployment
```

---

# 3. Botforge V2 Architecture

```text
                         Agent Platform
                              │
                         Contracts/API
                              │
                              ▼
                     ┌─────────────────┐
                     │    Botforge     │
                     │ Agent Bot       │
                     │ Factory         │
                     └────────┬────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
       Channel Layer      Agent Layer      Runtime Layer
            │                 │                 │
          LINE              Session           Codex
          Web               Workspace         Claude
        Telegram             Context          Gemini
        Discord              Memory            Qwen
            │                 │                 │
            └─────────────────┼─────────────────┘
                              │
                              ▼
                         Deployment
                              │
                    Docker / Cloudflare
```

---

# 4. Core Principle

จุดสำคัญที่สุดของ V2 คือ

> **Botforge ไม่ควรเป็น Agent Platform ตัวที่สอง**

และ

> **Agent Platform ไม่ควรรู้รายละเอียดของ LINE Bot**

จึงควรเชื่อมกันด้วย Contract

```text
Agent Platform
       │
       │ Agent / Runtime / Event Contract
       ▼
    Botforge
       │
       ├── LINE
       ├── Telegram
       ├── Web
       └── Other Channels
```

---

# 5. สิ่งที่ Botforge มีอยู่แล้วและควรรักษา

## Runtime Factory

ปัจจุบันมี runtime หลายตัว เช่น

```text
OpenCode
Claude Code
Gocode
ADKcode
Gemini CLI
Qwen Code
Codex
Codex App Server
Copilot CLI
```

ดังนั้นไม่ควรลบทิ้ง

แต่ค่อยจัด architecture ให้เป็น:

```text
Runtime Contract
       │
       ├── OpenCodeAdapter
       ├── ClaudeAdapter
       ├── CodexAdapter
       ├── GeminiAdapter
       ├── QwenAdapter
       └── ...
```

---

# 6. Session ต้องเป็น Core Capability

ของเดิมมี session ที่ค่อนข้าง mature อยู่แล้ว เช่น

```text
session per user/group
model preference
request queue
timeout
abort
retry
cost tracking
model switching
```

ดังนั้น V2 ควรยกระดับเป็น:

```text
Session
├── session_id
├── user
├── channel
├── agent
├── runtime
├── workspace
├── policy
└── metadata
```

โดยไม่ผูกกับ LINE

---

# 7. Workspace คือ Agent Context

ของเดิมมีแนวคิดนี้ดีมากแล้ว

`AGENTS.md` กำหนด role, rules, GitHub workflow, skills และ workspace behavior ของ agent โดยตรง

จึงควรรักษาแนวคิดนี้ไว้

```text
workspace/
├── AGENTS.md
├── README.md
├── skills/
├── knowledge/
├── memory/
├── docs/
├── policies/
└── tools/
```

และถือว่า

```text
Agent + Workspace
```

เป็น unit สำคัญของ Botforge

---

# 8. Channel Layer

ตอนนี้ LINE เป็น implementation หลัก

ให้จัด boundary เป็น:

```text
Channel Adapter
       │
       ▼
Botforge Core
```

LINE-specific logic เช่น

```text
signature validation
replyMessage
pushMessage
message chunking
mention
group events
profile
LINE loading
```

ควรอยู่ใน

```text
channels/line/
```

ไม่ควรไหลเข้า Core

Feature เหล่านี้มีอยู่จริงจำนวนมาก จึงควร **แยก boundary โดยไม่ลบ implementation**

---

# 9. Runtime Layer

Runtime-specific code ควรถูก isolate

```text
runtime/
├── opencode/
├── claude/
├── codex/
├── codex-appserver/
├── gemini/
├── qwen/
├── copilot/
├── gocode/
└── adkcode/
```

Core ไม่ควรมี logic แบบ:

```text
if engine == codex
if engine == claude
if engine == gemini
```

แต่ควรเป็น:

```text
RuntimeManager
      │
      └── RuntimeAdapter
```

---

# 10. Runtime Contract

เริ่มจาก contract เล็ก ๆ ก่อน

```text
createSession()
sendMessage()
streamEvents()
cancel()
getSession()
closeSession()
```

และ normalize events:

```text
agent.started
message.started
message.delta
message.completed

tool.started
tool.completed

agent.completed

error
```

เป้าหมายคือสามารถเปลี่ยน:

```text
Codex → Claude
```

โดยไม่ต้องแก้ Channel

และ

```text
LINE → Telegram
```

โดยไม่ต้องแก้ Runtime

---

# 11. Model Registry

`botforge-models` เป็นส่วนที่ควรรักษาเช่นกัน

ปัจจุบันมีแนวคิด provider/model registry และตรวจ model/config drift อยู่แล้ว

ให้มองระยะยาวเป็น:

```text
Model / Runtime Registry
```

แต่ **ยังไม่ต้องรีบย้ายออก**

ก่อนอื่นกำหนด ownership กับ `agent-platform`

ตัวอย่าง:

```text
Agent Platform
    │
    └── canonical runtime/model contract

Botforge
    │
    └── deployment/user-facing configuration
```

---

# 12. MCP

Botforge ไม่ควรสร้าง MCP framework ใหม่

แต่เป็น consumer ของ MCP

```text
Agent
 │
 Runtime
 │
 ├── MCP Server
 ├── GitHub
 ├── Context7
 ├── Search
 └── Custom Tools
```

ของเดิมที่มี workspace `.mcp.json` และ skills อยู่แล้วสามารถใช้ต่อได้

---

# 13. Deployment

`botforge-deploy` เป็นจุดแข็งที่ควรรักษา

ปัจจุบันมีแนวคิด:

```text
Multi Bot
Docker Compose
Status
Logs
Restart
Rebuild
Cloudflare Tunnel
DNS
```

จึงไม่ควรเอาออก

แต่ในอนาคตควรแยก:

```text
Botforge Core
       │
       │ deployment contract
       ▼
Botforge Deploy
```

เพื่อไม่ให้ deployment logic ปะปนกับ Agent logic

---

# 14. ความสัมพันธ์กับ devfactory-core

นี่สำคัญมาก

อย่าให้ Botforge กับ DevFactory สร้าง Factory ซ้ำกัน

```text
devfactory-core
       │
       │ Project Factory
       ▼
   Botforge Template
       │
       ▼
 Generated Agent Bot
```

ตัวอย่าง:

```text
devfactory
   │
   └── create project
          │
          ▼
      botforge template
          │
          ▼
       LINE Bot
          │
          ├── workspace
          ├── runtime
          └── deployment
```

ดังนั้น

**devfactory-core = factory orchestration**

**botforge = domain-specific bot factory**

---

# 15. Boundary ที่ต้องการ

| Capability               |                       Botforge |          Agent Platform |                DevFactory |
| ------------------------ | -----------------------------: | ----------------------: | ------------------------: |
| Agent execution          |                       Consumer |               **Owner** |                         - |
| Runtime contract         |                        Adapter |               **Owner** |                         - |
| Session semantics        | Channel/session implementation | **Canonical semantics** |                         - |
| LINE                     |                      **Owner** |                       - |                         - |
| Telegram/Web             |                      **Owner** |                       - |                         - |
| Workspace                | **Consumer/Owner integration** |                Contract |                         - |
| MCP                      |                       Consumer |                Contract |                         - |
| Agent policy             |                       Consumer |               **Owner** |                         - |
| Project template         |               **Bot-specific** |                       - | **Factory orchestration** |
| Repository               |                       Consumer |                       - |    **Owner/orchestrator** |
| Issue/PR workflow        |                   Bot-specific |                       - |    **Owner/orchestrator** |
| Docker deployment        |                      **Owner** |                       - |                         - |
| Cloudflare Tunnel        |                      **Owner** |                       - |                         - |
| Multi-repo orchestration |                              - |                       - |                 **Owner** |

---

# 16. Migration Strategy

## Phase 0 — Audit

**ห้าม rewrite**

สำรวจของจริงทั้งหมด:

```text
botforge CLI
botforge-models
botforge-deploy
templates
LINE implementation
session
runtime
workspace
MCP
credentials
deployment
```

สร้าง:

```text
docs/architecture/
├── current-state.md
├── component-map.md
├── runtime-matrix.md
├── dependency-map.md
└── target-state.md
```

---

## Phase 1 — Contract First

กำหนด:

```text
AgentContract
RuntimeContract
SessionContract
EventContract
WorkspaceContract
ToolContract
ChannelContract
```

โดยต้องตอบให้ได้ว่า:

> อะไรเป็น contract ของ ecosystem และอะไรเป็น implementation detail ของ Botforge

---

## Phase 2 — Internal Refactor

จัดโครงสร้างภายในโดย **ไม่เปลี่ยน behavior**

```text
botforge/
├── core/
├── agents/
├── sessions/
├── workspace/
├── runtime/
├── channels/
│   └── line/
├── models/
└── deployment/
```

เป้าหมายคือ architecture ชัดขึ้น แต่ feature เดิมยังทำงานเหมือนเดิม

---

## Phase 3 — Runtime Adapter

นำ runtime เดิมมาอยู่หลัง interface

```text
Runtime
   │
   ├── Codex
   ├── Claude
   ├── Gemini
   ├── Qwen
   ├── OpenCode
   └── ...
```

---

## Phase 4 — Agent Platform Integration

เมื่อ `agent-platform` contracts stable:

```text
Botforge
   │
   ├── Local Runtime
   │
   └── Agent Platform Runtime
```

ทำให้ Botforge เลือกได้ว่า agent ไหนจะรันที่ไหน

---

## Phase 5 — Multi-channel

หลังจาก Core stable ค่อยเพิ่ม:

```text
LINE
Telegram
Web
Discord
```

---

# 17. สิ่งที่ทีม "ไม่ควรทำ"

### ห้าม

* Rewrite Botforge ทั้งหมด
* ลบ runtime เดิม
* ลบ LINE implementation
* ย้ายทุกอย่างไป agent-platform
* สร้าง Agent Platform ซ้ำใน Botforge
* สร้าง multi-repo orchestration ซ้ำกับ devfactory-core
* เพิ่ม channel จำนวนมากก่อน contract stable

### ควร

* Preserve behavior
* Extract contracts
* Isolate adapters
* เพิ่ม test
* เพิ่ม integration test
* ทำ migration แบบ incremental

---

# 18. Definition of Done

Foundation ของ V2 ถือว่าใช้ได้เมื่อ flow นี้ทำงาน:

```text
User
 ↓
LINE
 ↓
Channel Adapter
 ↓
Botforge Core
 ↓
Agent
 ↓
Session
 ↓
Runtime Contract
 ↓
Runtime Adapter
 ↓
Codex / Claude / Gemini
 ↓
Normalized Events
 ↓
Botforge
 ↓
LINE
 ↓
User
```

และสามารถเปลี่ยน:

```text
LINE → Web
```

โดยไม่แก้ Runtime

และ:

```text
Codex → Claude
```

โดยไม่แก้ Channel

---

# 19. ภาพสุดท้าย

```text
                         ┌──────────────────────┐
                         │    devfactory-core   │
                         │                      │
                         │ Project Factory      │
                         │ Delivery             │
                         │ Multi-repo           │
                         └──────────┬───────────┘
                                    │
                              creates/manages
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────┐
│                         BOTFORGE                         │
│                                                          │
│                 Agent Bot Factory                        │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌────────────────────┐   │
│  │ Channel  │ → │  Agent   │ → │ Runtime Adapter    │   │
│  │          │   │ Session  │   │                    │   │
│  │ LINE     │   │ Workspace│   │ Codex              │   │
│  │ Web      │   │ Context  │   │ Claude             │   │
│  │ Telegram │   │ Memory   │   │ Gemini             │   │
│  └──────────┘   └──────────┘   │ Qwen / OpenCode... │   │
│                                └─────────┬──────────┘   │
│                                          │              │
│                                Docker / Cloudflare      │
└──────────────────────────────────────────┼─────────────┘
                                           │
                                  Runtime Contract
                                           │
                                           ▼
                              ┌──────────────────────┐
                              │    agent-platform   │
                              │                      │
                              │ Agent Runtime        │
                              │ Execution            │
                              │ Policy               │
                              │ Tools                │
                              │ Events               │
                              └──────────────────────┘
```

## 20. คำสั่งเริ่มต้นสำหรับทีม

**Sprint แรกยังไม่ต้องเพิ่ม feature**

ให้ทำ 5 เรื่องนี้ก่อน:

1. **Audit source จริง** และทำ `current-state.md`
2. ทำ **component/dependency map**
3. ระบุ **Botforge vs Agent Platform vs DevFactory boundary**
4. เสนอ `RuntimeContract / SessionContract / EventContract`
5. ทำ migration plan ที่สามารถ refactor ทีละส่วนโดยไม่ทำให้ Botforge เดิมเสีย

> **หลักการ V2:**
> **Preserve → Contract → Isolate → Integrate → Expand**
>
> ไม่ใช่
> **Rewrite → แล้วค่อยคิด architecture**

นี่จะทำให้ Botforge กลายเป็น **production-oriented Agent Bot Factory** ที่ใช้ประโยชน์จากของเดิมได้เต็มที่ และในขณะเดียวกันก็กลายเป็นหนึ่งในตัว consumer สำคัญของ `agent-platform` และ `devfactory-core` โดยไม่ทำให้ทั้งสาม repo กลายเป็นระบบเดียวกันครับ

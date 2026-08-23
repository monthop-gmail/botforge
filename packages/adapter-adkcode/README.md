# @botforge/adapter-adkcode

`RuntimePort` สำหรับ **adkcode** — Google ADK multi-agent หลัง FastAPI

## engine เดียวใน 9 ที่เป็น multi-agent จริง

```python
root_agent = Agent(..., sub_agents=[coder, reviewer, tester])
```

หนึ่ง prompt แตกเป็นหลาย agent · `coder` เขียนโค้ด · `reviewer` อ่านอย่างเดียว · `tester` รันเทสต์

## ทำไมยังปล่อย execution เดียว ไม่ใช่ tree

`execution/v1` รองรับ sub-agent อยู่แล้ว:

```yaml
parent_execution_id:  ใช้กับ sub-agent / delegation — สิทธิ์ของลูกต้องไม่กว้างกว่าพ่อ
parallel_substates:   งานคู่ขนานทำโดยสร้าง execution ลูก ไม่ใช่ substate ในตัวเดียว
```

**แต่ API ของ adkcode มองไม่เห็น sub-agent จากภายนอก** — `server/api.py` วน `runner.run_async()`
แล้วเก็บเฉพาะ `event.is_final_response()` · event ระหว่างทาง (ซึ่ง ADK ใส่ `author` เป็นชื่อ agent มาด้วย)
ถูกทิ้งไป HTTP จึงคืนแค่ข้อความสุดท้ายก้อนเดียว

`execution/v1` เขียนกรณีนี้ไว้แล้วที่ `observability_depth`:

> external provider มักให้ได้แค่ turn — consumer ต้องยอมรับ trace ที่ไม่มี step ย่อย
> **ห้ามถือว่า execution ที่ไม่มี step คือ execution ที่ไม่ได้ทำอะไร**

adapter จึงประกาศ **`observabilityDepth: "turn"` ตามความจริง — ไม่แต่ง event ปลอมขึ้นมา**

### ทางไป `step` มีอยู่ชัด

ให้ `api.py` ส่ง `author` ของแต่ละ event ออกมา (SSE หรือใส่ใน response) แล้ว adapter
สร้าง execution ลูกที่มี `parent_execution_id` ได้ทันที — แต่ต้องแก้ฝั่ง server
ซึ่งอยู่บน `main` ที่ freeze ไว้ที่ `v1-final` จึงเป็นงานของ Phase ถัดไป ไม่ใช่ตอนนี้

## สิ่งที่ต่างจาก engine อื่น

| | adkcode | อื่น ๆ |
| --- | --- | --- |
| `createSession` | **ต้องมี `user_id`** — ADK ผูก session กับผู้ใช้ | ไม่ต้องรู้จักผู้ใช้ |
| session ที่ยุ่งอยู่ | **ตอบ `409`** ตรง ๆ | ใช้คิวของ core กันไว้ |
| timeout | ไม่มีคำตอบบางส่วนให้ดึง | `opencode` มี `fetchLastAssistantMessage` |
| **GROUP CHAT instruction** | **ไม่มี** (feature 4.7 — ตัวเดียวใน 9) | มีครบ |
| question guard | ห้าม "ถามกลับ" เฉย ๆ | `opencode` ระบุเจาะจงว่าห้ามใช้ question **tool** |

### ⚠️ `[SKIP]` ของ adkcode ยิงได้แค่บังเอิญ

ฝั่ง bot ของ v1 **เช็ค `[SKIP]`** อยู่ แต่ prefix **ไม่เคยบอก model ให้ตอบ `[SKIP]`**
— ตรวจหาคำตอบที่ไม่เคยสั่งให้ผลิต

ยกมาเหมือนเดิมเพื่อไม่เปลี่ยนพฤติกรรมเงียบ ๆ · เปิดได้ด้วย `groupChatInstruction: true`

```ts
new AdkcodeAdapter({ url, groupChatInstruction: true })   // ให้ [SKIP] ทำงานจริง
```

## gap ของ core ที่ปิดไปด้วย — `409` → `conflict`

เดิม `409 Session is busy` ตกเป็น `internal` แล้วผู้ใช้ได้ข้อความ *"เกิดข้อผิดพลาดครับ: …"*
ทั้งที่ `error/v1` มี category `conflict` อยู่แล้วและมันแค่ต้องรอ

เพิ่ม rule `runtime.session_busy` → `conflict` · `retryable: true` ·
*"กำลังตอบข้อความก่อนหน้าอยู่ครับ รอสักครู่แล้วส่งใหม่"*

> ⚠️ **ห้ามใช้ `"409"` เป็น needle** — characterization test จับได้ว่ามันไปตรงกับ
> `ECONNREFUSED 127.0.0.1:4096` (เลข port ของ opencode มี `409` อยู่ข้างใน)
> มี regression test ล็อกไว้แล้ว

## test

```bash
npm test --prefix packages/adapter-adkcode
```

12 test · fake server ที่เคารพ `AbortSignal` จริง ครอบ 409 · 404 retry · timeout · `/new` · `/abort`

## ยังไม่ได้ทำ

- ยังไม่ได้ยิง adkcode ตัวจริง — ต้องมี Google ADC หรือ `GOOGLE_API_KEY`
  (มี container `legal-services` รันอยู่บนเครื่องนี้ แต่เป็นของลูกค้า ไม่ควรไปยุ่ง)
- sub-agent execution tree — รอ `api.py` ส่ง `author` ออกมา
- MCP ของ adkcode (`mcp_config.py`) โหลด `mcp.json` ได้แต่ไม่มี template ไหน ship มา

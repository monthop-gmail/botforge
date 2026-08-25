# Model tool capability — ผลทดสอบจริง 2026-08-25

ทดสอบ **84 model** ที่อยู่ใน `/model` ของ `nst-opencode` สองเรื่อง — `tool` ที่ opencode ยื่นให้
(ถามจาก API ไม่ต้องยิง inference) และ **ใช้ได้จริงไหม** โดยถาม `"วันนี้มีข่าวอะไรบ้าง"`
แล้วดูจาก session ว่าเรียก tool จริงหรือเปล่า

## ⚠️ อ่านก่อนใช้ตัวเลขไปตัดสินใจ

**นี่คือผล 1 รอบต่อ model — บอกได้แค่ "เคยทำได้" ไม่ใช่ "ทำได้เสมอ"**

`gateway/oc/minimax-m3` บังเอิญถูกยิง 2 รอบ (ใช้เป็น control) ผลออกมาคนละขั้ว:

```
รอบ1  ไม่ใช้ tool เลย → "ผมไม่สามารถดึงข่าวสดแบบ real-time ได้"
รอบ2  ใช้ webfetch    → "ข่าวเด่นวันนี้ (25 ส.ค. 2569) จาก BBC News ไทย..."
```

**คำถามเดียวกัน model เดียวกัน ผลตรงข้าม** — ความสามารถนี้ไม่ใช่คุณสมบัติตายตัวของ model
แต่ขึ้นกับว่ารอบนั้นมันเลือกจะลองใช้ tool หรือยอมแพ้ก่อน ตัวที่ตารางบอกว่าทำไม่ได้ อาจทำได้ถ้ายิงใหม่

## tool ที่ opencode ยื่นให้

`GET /experimental/tool?provider=X&model=Y` — ได้คำตอบโดยไม่ต้องยิง inference ไม่กิน quota ใคร

ชุดเต็ม 13 tool: `bash` `edit` `glob` `grep` `invalid` `question` `read` `skill` `task` `todowrite` `webfetch` `websearch` `write`

| กลุ่ม | จำนวน | ขาดอะไร |
| --- | ---: | --- |
| `opencode` (Zen) | 7 | **ไม่ขาดอะไร — ครบ 13** |
| `gateway` 50 · `okmd` 20 · `thaillm` 4 | 74 | `websearch` |
| `okmd/gpt-5.4` · `-mini` · `-nano` | 3 | `websearch` **+ `edit` + `write`** |

- **`webfetch` ครบ 84/84** — ดึง URL ที่ระบุมาอ่านได้ทุกตัว
- **`websearch` แค่ 7/84** — เฉพาะ `opencode/*` เพราะ Zen มีบริการ search ในตัว
- ⚠️ `okmd/gpt-5.4` ทั้ง 3 ตัว **เขียนไฟล์ไม่ได้** เป็นตัวแรงที่สุดในรายการแต่แก้โค้ดไม่ได้
  ถ้าสั่งให้แก้ไฟล์ มันอาจตอบว่าทำแล้วทั้งที่ทำไม่ได้

## ผลทดสอบ — ถาม "วันนี้มีข่าวอะไรบ้าง"

| กลุ่ม | ทั้งหมด | ✅ ดึงจริง | บอกตรงว่าทำไม่ได้ | `[SKIP]` | ผิดปกติ | error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `opencode` | 7 | **7** | 0 | 0 | 0 | 0 |
| `thaillm` | 4 | **1** | 3 | 0 | 0 | 0 |
| `okmd` | 23 | **9** | 10 | 1 | 2 | 1 |
| `gateway` | 50 | **27** | 11 | 5 | 1 | 7 |
| **รวม** | **84** | **44** | 24 | 6 | 3 | 8 |

### `opencode` 7/7 — กลุ่มเดียวที่ทำได้ทุกตัว
มี `websearch` ในตัว ไม่ต้องพึ่งว่า model จะคิดออกเองไหม

### `[SKIP]` 6 ตัว — ไม่ใช่ความผิดของ model
`workspace/AGENTS.md:10` สั่งไว้ว่า *"ในกลุ่ม LINE: ถ้าข้อความไม่ได้เรียกถึง bot โดยตรง ให้ตอบ [SKIP] เท่านั้น"*
workspace mount เข้าทุก session **รวม session ที่สร้างผ่าน API ตอนทดสอบ** model จึงทำตามไฟล์
เวลาอ่านผลต้องแยกออกจากกลุ่ม "ทำไม่ได้"

### อาการผิดปกติ 3 ตัว — คนละแบบกันหมด

| model | อาการ | ทำไมสำคัญ |
| --- | --- | --- |
| `okmd/gemini-3.1-flash-lite-preview` | 🔴 **แต่งข่าวขึ้นมาเอง** ไม่แตะ tool เลย ตอบเป็นข่าวกว้าง ๆ ที่ไม่มีรายละเอียดจริง | ผู้ใช้แยกไม่ออกว่าจริงหรือมั่ว — อันตรายกว่าตัวที่บอกว่าทำไม่ได้ |
| `okmd/gemini-3.5-flash` | **พิมพ์ tool call ออกมาเป็นข้อความ** `[tool_call:default_api:bash{command:python3 -c ...}]` แทนที่จะเรียกจริง | มันรู้ว่าต้องทำอะไรและเขียนโค้ดถูกด้วย แต่ format ไม่เข้ากับ opencode |
| `gateway/or/north-mini-code` | **หลุด internal planning** ออกมาเป็นคำตอบ `## Objective - User wants to know...` | ผู้ใช้เห็นความคิดภายในแทนคำตอบ |

## วิธีที่ model ใช้หาข่าวทั้งที่ไม่มี `websearch`

ตัวที่ทำได้ไม่ได้รอ `websearch` แต่ไปหาทางเอง:

```
webfetch  {"url": "https://news.google.com/rss?hl=th&gl=TH&ceid=TH:th", "format": "text"}
```
แล้วแยกหัวข้อคนละวิธี — `minimax-m3` ใช้ `task` spawn subagent มาสรุป · `ox-alpha` ใช้
`bash` + `grep -o '<title>[^<]*</title>'` ดึงเอง · บางตัวไป BBC News ไทยแทน

**นี่คือความรู้ของ model เอง ไม่ใช่ความสามารถที่ระบบมอบให้** — จึงอธิบายว่าทำไมผลไม่คงที่

## ข้อเสนอ — บอกวิธีไว้ใน `AGENTS.md`

ถ้าความต่างอยู่ที่ "คิดออกหรือไม่คิดออก" การเขียนวิธีไว้ให้อ่านน่าจะทำให้สม่ำเสมอขึ้น
โดยไม่ต้องเปลี่ยน model และไม่ต้องพึ่ง `websearch` ที่มีแค่ 7 ตัว

```markdown
## หาข้อมูลสด (ข่าว ราคา สภาพอากาศ)
ถ้าไม่มี tool `websearch` ให้ใช้ `webfetch` กับแหล่งที่เปิดสาธารณะแทน
- ข่าวไทย  https://news.google.com/rss?hl=th&gl=TH&ceid=TH:th
- ข่าวโลก  https://feeds.bbci.co.uk/news/world/rss.xml
อย่าเพิ่งตอบว่าทำไม่ได้ก่อนลอง
```

**ยังไม่ได้ทดสอบว่าได้ผลจริงไหม** และต้องวัดผลข้างเคียงด้วย — การกดดันว่า "อย่าตอบว่าทำไม่ได้"
อาจเปลี่ยนตัวที่เคยบอกตรง ๆ (24 ตัว) ให้กลายเป็นแต่งขึ้นมาแทน ซึ่งแย่กว่าเดิม
ต้องวัดทั้ง "ดึงจริงเพิ่มขึ้นไหม" และ "แต่งขึ้นมาเพิ่มขึ้นไหม" คู่กัน

ทางเลือกอื่นที่ยังไม่ได้ลอง — เพิ่ม **MCP server** ที่ให้ search จริง จะได้ไม่ต้องพึ่งวิจารณญาณ model เลย

## ตารางเต็มรายตัว

| model | ผล | tool ที่เรียกจริง | `websearch` |
| --- | --- | --- | :-: |
| `opencode/big-pickle` | ✅ ดึงจริง | `websearch` | ✓ |
| `opencode/hy3-free` | ✅ ดึงจริง | `websearch` | ✓ |
| `opencode/mimo-v2.5-free` | ✅ ดึงจริง | `websearch` | ✓ |
| `opencode/muse-spark-1.2-contributor-free` | ✅ ดึงจริง | `websearch` | ✓ |
| `opencode/nemotron-3-ultra-free` | ✅ ดึงจริง | `websearch` | ✓ |
| `opencode/nemotron-3.5-lightning-free` | ✅ ดึงจริง | `read` `websearch` `write` | ✓ |
| `opencode/x-preview-f-free` | ✅ ดึงจริง | `websearch` | ✓ |
| `thaillm/openthaigpt-8b` | — บอกตรง | — |  |
| `thaillm/pathumma-8b` | ✅ ดึงจริง | `webfetch` |  |
| `thaillm/thalle-8b` | — บอกตรง | — |  |
| `thaillm/typhoon-s-8b` | — บอกตรง | — |  |
| `okmd/claude-sonnet-4.6` | — บอกตรง | — |  |
| `okmd/claude-sonnet-5` | — บอกตรง | — |  |
| `okmd/deepseek-v4-flash` | ✅ ดึงจริง | `webfetch` |  |
| `okmd/deepseek-v4-pro` | ✅ ดึงจริง | `webfetch` |  |
| `okmd/gemini-2.5-flash-lite` | — บอกตรง | — |  |
| `okmd/gemini-3.1-flash-lite` | — บอกตรง | — |  |
| `okmd/gemini-3.1-flash-lite-preview` | 🔴 แต่ง | — |  |
| `okmd/gemini-3.1-pro-preview` | ✅ ดึงจริง | `bash` |  |
| `okmd/gemini-3.5-flash` | ⚠️ tool format ผิด | — |  |
| `okmd/gemini-3.7-flash` | ✅ ดึงจริง | `bash` |  |
| `okmd/gpt-5.4` | ✅ ดึงจริง | `webfetch` |  |
| `okmd/gpt-5.4-mini` | ✅ ดึงจริง | `webfetch` |  |
| `okmd/gpt-5.4-nano` | ✅ ดึงจริง | `webfetch` |  |
| `okmd/grok-4.3` | ✅ ดึงจริง | `task` `webfetch` |  |
| `okmd/llama-4-maverick` | — บอกตรง | — |  |
| `okmd/llama-4-scout` | ✅ ดึงจริง | `webfetch` |  |
| `okmd/mistral-medium-3.1` | `[SKIP]` | — |  |
| `okmd/nova-2-lite-v1` | — บอกตรง | — |  |
| `okmd/nova-pro-v1` | — บอกตรง | — |  |
| `okmd/qwen3.6-flash` | — บอกตรง | — |  |
| `okmd/qwen3.7-max` | — บอกตรง | — |  |
| `okmd/qwen3.7-plus` | — บอกตรง | — |  |
| `okmd/sonar-pro` | ว่าง | — |  |
| `gateway/cb/gemma-4-31b` | — บอกตรง | — |  |
| `gateway/cb/gpt-oss-120b` | `[SKIP]` | — |  |
| `gateway/cf/gemma-4-26b` | error | — |  |
| `gateway/cf/nemotron-3-120b` | error | — |  |
| `gateway/cf/qwen3.8-27b` | error | — |  |
| `gateway/gq/qwen3.6-27b` | error | — |  |
| `gateway/hf/deepseek-r1` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/deepseek-v3.2` | — บอกตรง | — |  |
| `gateway/hf/deepseek-v4-pro` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/gemma-4-26b` | — บอกตรง | — |  |
| `gateway/hf/glm-4.7` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/glm-5.2` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/gpt-oss-120b` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/gpt-oss-20b` | ✅ ดึงจริง | `grep` `webfetch` |  |
| `gateway/hf/kimi-k2.6` | ✅ ดึงจริง | `task` `webfetch` |  |
| `gateway/hf/kimi-k3` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/qwen2.5-7b` | — บอกตรง | — |  |
| `gateway/hf/qwen3-coder-next` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/hf/qwen3.5-397b` | — บอกตรง | — |  |
| `gateway/hf/qwen3.6-27b` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/mi/codestral` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/mi/devstral` | `[SKIP]` | — |  |
| `gateway/mi/devstral-medium` | `[SKIP]` | — |  |
| `gateway/mi/large` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/mi/magistral-medium` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/mi/medium` | `[SKIP]` | — |  |
| `gateway/mi/ministral-14b` | `[SKIP]` | — |  |
| `gateway/mi/ministral-8b` | — บอกตรง | — |  |
| `gateway/mi/mistral-code` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/nim/nemotron-nano-30b` | ✅ ดึงจริง | `grep` `read` `webfetch` |  |
| `gateway/nim/nemotron-super-49b` | — บอกตรง | — |  |
| `gateway/nim/step-3.7-flash` | ✅ ดึงจริง | `bash` `read` `todowrite` `webfetch` |  |
| `gateway/oc/gemma4-31b` | — บอกตรง | — |  |
| `gateway/oc/gpt-oss-120b` | ✅ ดึงจริง | `task` `webfetch` |  |
| `gateway/oc/gpt-oss-20b` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/oc/minimax-m3` | — บอกตรง/✅ ดึงจริง | `webfetch` |  |
| `gateway/oc/nemotron-3-nano-30b` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/oc/nemotron-3-super` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/oc/nemotron-3-ultra` | ✅ ดึงจริง | `task` `webfetch` |  |
| `gateway/or/auto-free` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/or/dots-3-note` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/or/laguna-s-2.1` | — บอกตรง | — |  |
| `gateway/or/nemotron-lightning` | — บอกตรง | `glob` `read` |  |
| `gateway/or/nemotron-nano-30b` | error | — |  |
| `gateway/or/nemotron-nano-9b` | error | — |  |
| `gateway/or/nemotron-super-120b` | ✅ ดึงจริง | `webfetch` |  |
| `gateway/or/nemotron-ultra-550b` | ✅ ดึงจริง | `task` `webfetch` |  |
| `gateway/or/nemotron-vl-12b` | error | — |  |
| `gateway/or/north-mini-code` | ⚠️ หลุด planning | `glob` `read` `task` |  |
| `gateway/or/ox-alpha` | ✅ ดึงจริง | `webfetch` |  |

---

## วิธีทดสอบซ้ำ

1. `GET /experimental/tool?provider=X&model=Y` — tool ที่ยื่นให้ ไม่กิน quota
2. `POST /session` → `POST /session/{id}/message` ถามคำถาม
3. **`GET /session/{id}/message` เพื่อดู tool ที่ถูกเรียก**

> ⚠️ ข้อ 3 ขาดไม่ได้ — **`POST` ไม่คืน `tool` part** มีแต่ `step-start` / `reasoning` / `text` / `step-finish`
> ดูจาก `POST` อย่างเดียวจะได้ผลว่า "ไม่มีใครเรียก tool เลย" ซึ่งผิดทั้งหมด (พลาดมาแล้ววันนี้)

> ใส่ **control ที่รู้ผลแน่นอนไว้ทุกรอบ** — ถ้า control ตกแปลว่าเครื่องมือพัง ไม่ใช่ model
> วันนี้ควบคุมจับได้ 2 ครั้ง ทั้งสองครั้งอาการคือ "ทุกตัวตกหมด" ซึ่งแทบไม่มีทางเป็นผลจริง

> อย่าเชื่อ regex ที่จัดกลุ่มคำตอบ — รอบแรกจัด 7 ตัวเป็น "แต่งข่าว" พออ่านข้อความเต็มจริง ๆ
> เหลือแค่ 1 ตัว ที่เหลือเป็นการปฏิเสธที่ regex จับไม่ติด

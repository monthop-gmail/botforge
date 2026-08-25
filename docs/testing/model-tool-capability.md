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

## ทดลองแล้ว — บอกวิธีไว้ใน `AGENTS.md` **ไม่ได้ผล** (2026-08-25)

สมมติฐาน: ถ้าความต่างอยู่ที่ "คิดออกหรือไม่คิดออก" การเขียนวิธีไว้ให้อ่านน่าจะทำให้สม่ำเสมอขึ้น
โดยไม่ต้องเปลี่ยน model และไม่ต้องพึ่ง `websearch` ที่มีแค่ 7 ตัว

เพิ่ม section นี้เข้า `workspace/AGENTS.md` — จงใจเขียนคู่กันสองด้านเพื่อไม่ให้ดันไปทางแต่งข่าว:

```markdown
## หาข้อมูลสด (ข่าว ราคา สภาพอากาศ)
**ความรู้ในตัวคุณเก่าเสมอ** ห้ามตอบคำถามพวกนี้จากความจำเด็ดขาด
| ข่าวไทย | https://news.google.com/rss?hl=th&gl=TH&ceid=TH:th |
| ข่าวโลก | https://feeds.bbci.co.uk/news/world/rss.xml |
- ลอง webfetch ก่อนเสมอ อย่าเพิ่งบอกว่าทำไม่ได้
- ถ้าดึงไม่สำเร็จ ให้บอกตรง ๆ ว่าดึงไม่ได้ — ห้ามเดาเนื้อข่าวมาตอบแทน
- ข้อมูลที่ไม่ได้มาจาก tool ในรอบนี้ ถือว่าไม่มี
```

ยิงซ้ำ **19 ตัวเดียวกัน** (14 ตัวที่เคยปฏิเสธ + 1 ที่หลุด planning + control 4 ตัวที่เคยทำได้)
เว้น `okmd` ไว้เพราะจะกินโควตารายวันซ้ำ

| | ก่อน | หลัง |
| --- | ---: | ---: |
| ✅ ดึงจริง | 4 | **4** |
| — บอกตรงว่าทำไม่ได้ | 14 | 11 |
| 🔴 แต่งขึ้นมา | 0 | **1** |
| error | 0 | 3 |

**⬆️ ดีขึ้น 1 · ⬇️ แย่ลง 1 · เท่าเดิม 17**

- `gateway/hf/qwen3.5-397b` เปลี่ยนมาใช้ `webfetch` จริง — ตัวเดียวที่ดีขึ้น
- `gateway/hf/deepseek-v3.2` เปลี่ยนจาก "บอกตรง ๆ" → **"แต่งขึ้นมา"** = ผลข้างเคียงที่กลัวเกิดจริง
- `gateway/hf/deepseek-v4-pro` เคยดึงได้ กลับมาบอกว่าทำไม่ได้ = regression
- 3 ตัวที่ error เป็น OpenRouter ที่ rate limit ง่าย น่าจะไม่เกี่ยวกับ `AGENTS.md`

**ตีความอย่างระวัง** — จำได้ว่า `minimax-m3` ให้ผลคนละขั้วในสองรอบ ดังนั้น "ดีขึ้น 1 แย่ลง 1"
อาจเป็นแค่ความผันผวนตามธรรมชาติ ไม่ใช่ผลของการแก้เลย ที่บอกได้แน่คือ **ไม่มีสัญญาณว่าดีขึ้นชัดเจน**
ถ้าได้ผลจริงควรเห็น 5–10 ตัวเปลี่ยนมาใช้ tool ไม่ใช่ 1

**ถอย `AGENTS.md` กลับแล้ว** — หลักฐานไม่พอว่าดีขึ้น แต่มีสัญญาณว่าอาจดันให้แต่ง

### บทเรียน

11 ตัวยังบอกว่าทำไม่ได้ **ทั้งที่มีคู่มือพร้อม URL วางอยู่ตรงหน้า** แสดงว่าปัญหาไม่ใช่
"ไม่รู้วิธี" แต่เป็น **"ไม่คิดจะลอง"** — เขียนคู่มือเพิ่มจึงไม่ช่วย

ทางที่น่าจะตรงเหตุกว่าคือ **MCP server ที่ให้ search จริง** เพราะเปลี่ยนจาก "หวังว่า model จะคิดออก"
เป็น "ยื่น tool ให้ตรง ๆ" แบบเดียวกับที่ `opencode/*` 7 ตัวทำได้ 7/7 เพราะมี `websearch` ในตัว
**ยังไม่ได้ทดลอง**

## ทดลองแล้ว — MCP search **ได้ผลชัดเจน** แต่ยังไม่เอาเข้า production (2026-08-25)

หลังพบว่าแก้ `AGENTS.md` ไม่ได้ผล จึงลองทางที่ตรงเหตุกว่า — **ยื่น tool ให้ตรง ๆ**
แทนที่จะหวังว่า model จะคิดออกเองว่าต้องยิง RSS ไหนแล้ว parse XML ยังไง

ใช้ `duckduckgo-mcp-server` (ฟรี ไม่ต้องมี API key) ต่อผ่าน `opencode.json`:

```json
"mcp": { "ddg": { "type": "local", "command": ["duckduckgo-mcp-server"], "enabled": true } }
```

### ผล — เทียบสามทางบน 19 model ชุดเดียวกัน

| | ✅ ดึงจริง | บอกตรงว่าทำไม่ได้ | 🔴 แต่ง | error |
| --- | ---: | ---: | ---: | ---: |
| ก่อนแก้ | 4 | 14 | 0 | 0 |
| แก้ `AGENTS.md` | 4 | 11 | 1 | 3 |
| **มี MCP** | **13** | **2** | 1 | 3 |

**4 → 13 เพิ่มสามเท่า** · ตัวที่บอกว่าทำไม่ได้เหลือ 2 จาก 14

9 ตัวที่พลิกจาก "ทำไม่ได้" เป็น "ทำได้" — `cb/gemma-4-31b` · `hf/deepseek-v3.2` ·
`hf/gemma-4-26b` · `hf/qwen2.5-7b` · `hf/qwen3.5-397b` · `nim/nemotron-super-49b` ·
`oc/gemma4-31b` · `oc/minimax-m3` · `thaillm/thalle-8b`

**หลักฐานที่ตรงที่สุด** — `hf/deepseek-v3.2` ตัวที่ `AGENTS.md` ทำให้ *แต่งข่าว*
พอมี MCP กลับมา *ดึงจริง* แสดงว่าสองวิธีนี้แก้คนละปัญหา

ยืนยันสมมติฐาน: ปัญหาคือ **"ไม่คิดจะลอง" ไม่ใช่ "ไม่รู้วิธี"** — เขียนคู่มือให้อ่านไม่ช่วย (4→4)
แต่ยื่น tool ให้ตรง ๆ ช่วย (4→13) model ไม่ได้ขี้เกียจ มันแค่ไม่มองว่า "ยิง RSS แล้ว parse เอง"
เป็นวิธีตอบคำถามเรื่องข่าว แต่พอเห็น tool ชื่อ `ddg_search` มันใช้ทันที

### 🔒 ทำไมยังไม่เอาเข้า production

`duckduckgo-mcp-server` เป็น package ของ **community** (`nickclyde/duckduckgo-mcp-server`)
ไม่ใช่ official และในบริบทนี้มันได้สิทธิ์เยอะกว่าที่ควร:

- รันเป็น process ใน container เดียวกับ opencode
- container นั้นมี `bash` เต็มรูปแบบ — `git clone` จากอินเทอร์เน็ตได้จริง (เห็นมาแล้วจาก log)
- mount `/workspace` ซึ่งเป็น repo ของลูกค้า
- มี `.env` ที่มี key ของ LINE · Cloudflare · OKMD · LiteLLM

**ติดตั้งจากชื่อบน PyPI โดยไม่ได้อ่านโค้ดเลยสักบรรทัด** — ความเสี่ยง supply chain

ถอย `Dockerfile.opencode` และ `opencode.json` กลับหมดแล้ว rebuild image ใหม่ให้สะอาด
(ยืนยัน: ไม่มี `duckduckgo-mcp-server` ใน image · `big-pickle` และ `gateway` ตอบ 391 ·
LINE ยิง webhook ทดสอบได้ `success: true`)

### ถ้าจะเอาจริงในอนาคต — ทางที่ปลอดภัยกว่า

| ทาง | ข้อดี | ข้อเสีย |
| --- | --- | --- |
| `@modelcontextprotocol/server-brave-search` | อยู่ใต้ org **official** ของ MCP | ต้องมี Brave API key (มี free tier) |
| รัน MCP ใน **container แยก** ต่อแบบ `type: remote` | ไม่มีสิทธิ์แตะ workspace/`.env` เลย | ต้องดูแลอีก service |
| self-host **SearXNG** แล้วเขียน MCP บาง ๆ เอง | ควบคุมได้ทั้งหมด | งานเยอะสุด |

ทางที่สองน่าจะคุ้มที่สุด — ได้ประโยชน์ของ MCP โดยตัว server ไม่มีสิทธิ์อะไรใน container ของ bot

### กับดักที่เจอ

- **`/experimental/tool` ไม่แสดง tool ของ MCP** แสดงแต่ built-in — ตอนเปิด MCP แล้วเห็นจำนวน
  tool เท่าเดิม เกือบสรุปว่าไม่ทำงาน ทั้งที่ทำงานอยู่ ต้องยิงทดสอบจริงถึงจะเห็น `ddg_search`
- **pip ถอยรุ่นเงียบ ๆ** — ใส่ `duckduckgo-mcp-server` ไว้บรรทัดเดียวกับ `mcp>=1.0,<1.10`
  ได้ `0.1.2` ไม่ใช่ `0.6.1` ที่ทดสอบไว้ตอนแรก บังเอิญที่ `0.1.2` ใช้ได้เหมือนกัน
  ถ้าจะเอาจริงต้อง pin รุ่นให้ชัด

### ที่ยังค้าง

- `thaillm/openthaigpt-8b` เปลี่ยนจาก "บอกตรง ๆ" → "แต่ง" ทิศทางเดียวกับที่ `AGENTS.md` ทำ
  อาจเป็นความผันผวน หรือมี tool แล้วมั่นใจเกิน — ต้องยิงซ้ำถึงจะรู้
- `mi/ministral-8b` · `thaillm/typhoon-s-8b` มี tool แล้วก็ยังไม่ใช้
- ยังไม่ได้ทดสอบกับ `okmd` 14 ตัว (เว้นไว้กันเผาโควตารายวัน)

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

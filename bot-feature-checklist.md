# LINE Bot Feature Checklist

Template สำหรับ audit features ของ LINE bot templates/projects ต่าง
อ้างอิงจาก **opencode-line** และ **oc-line-claude** เป็น baseline (feature-complete)

---

## วิธีใช้

1. Copy ตาราง checklist ด้านล่าง
2. เปิด `src/index.ts` หรือ main ของ line-bot container ของ bot project ที่ต้องการ audit
3. เช็คแต่ละ feature ว่ามีหรือไม่ — ใส่ ✅ / ❌ / ⚠️ (มีแต่ไม่สมบูรณ์)
4. เพิ่มหมายเหตุที่คอลัมน์ Notes

---

## 1. Bot Commands

| # | Command | Aliases | คำอธิบาย | Status | Notes |
|---|---------|---------|----------|:------:|-------|
| 1.1 | `/new` | — | เริ่ม session ใหม่ (ลบ session เดิม) | | |
| 1.2 | `/abort` | — | ยกเลิก prompt ที่กำลังทำ | | |
| 1.3 | `/sessions` | — | ดูสถานะ session ปัจจุบัน | | |
| 1.4 | `/model` | `/model <provider/model>` | ดูรายการ / เปลี่ยน AI model | | |
| 1.5 | `/model` partial match | e.g. `qwen-plus` | auto-resolve partial name | | |
| 1.6 | `/about` | `/who` | แนะนำตัว bot + แสดง model ปัจจุบัน | | |
| 1.7 | `/help` | `/คำสั่ง` | แสดงคำสั่งทั้งหมด | | |

## 2. AI / Session Management

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 2.1 | Multi-provider models | รองรับหลาย provider (opencode, anthropic, deepseek, google, openai, qwen) | | |
| 2.2 | Model list (MODELS map) | `Record<string, { providerID, modelID, label }>` | | จำนวน models: |
| 2.3 | Default model | ค่า default เมื่อไม่ได้เลือก | | model: |
| 2.4 | Model pref per session | `modelPrefs` Map — เก็บ model ต่อ group/user | | |
| 2.5 | Session per group/user | `sessions` Map — key = groupId/roomId/userId | | |
| 2.6 | Auto-retry on 404 | session expired → สร้างใหม่อัตโนมัติ | | |
| 2.7 | Prompt timeout | `PROMPT_TIMEOUT_MS` + AbortController | | timeout ms: |
| 2.8 | Partial response on timeout | abort → fetch last assistant message | | |
| 2.9 | Question tool prevention | prefix `[IMPORTANT: Do NOT use the question tool...]` | | |

## 3. LINE Integration

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 3.1 | Signature validation | HMAC SHA256 verify `x-line-signature` | | |
| 3.2 | replyMessage first | ใช้ reply (ฟรี) ก่อน fallback push | | |
| 3.3 | pushMessage retry | retry 3 ครั้ง เมื่อ 429 rate limit | | |
| 3.4 | Message chunking | แบ่งข้อความยาว (LINE limit 5000 chars) | | |
| 3.5 | Code block balancing | ปิด ``` ที่ค้างเมื่อ chunk | | |
| 3.6 | Loading animation | `showLoadingAnimation` ใน 1:1 chat | | |
| 3.7 | Image handling | รับรูป — ตอบว่าดูไม่ได้ (1:1) / silent (group) | | |
| 3.8 | Join event | welcome message เมื่อ bot เข้ากลุ่ม | | |
| 3.9 | Leave event | cleanup session เมื่อ bot ออกกลุ่ม | | |
| 3.10 | Bot mention detection | `@bot`, LINE mention API | | |

## 4. Group Chat

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 4.1 | Shared session per group | groupId เป็น session key (ทุกคนใน group ใช้ session เดียว) | | |
| 4.2 | `[SKIP]` detection | AI ตัดสินว่าข้อความเกี่ยวกับ bot หรือไม่ | | |
| 4.3 | Group name context | `getGroupSummary` → inject group name | | |
| 4.4 | Group memory injection | อ่าน `memory-{groupId}.md` จาก workspace | | |
| 4.5 | Session-only injection | inject memory เฉพาะ new session (ไม่ทุกข้อความ) | | |
| 4.6 | Group member profile | `getGroupMemberProfile` (ไม่ใช่ `getProfile`) | | |

## 5. Context Enrichment

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 5.1 | User profile caching | `UserProfile` interface + 1hr cache | | |
| 5.2 | User context | `[User Info: displayName (messages: N)]` | | |
| 5.3 | Time context | `[Time: YYYY-MM-DD HH:MM:SS+07:00]` Bangkok TZ | | |
| 5.4 | Reply/Quote context | `quotedMessageId` → inject reply context | | |
| 5.5 | Group info context | `[Group Info: groupName]` | | |

## 6. Error Handling

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 6.1 | API error extraction | `extractResponse()` checks `result.info.error` | | |
| 6.2 | Error hints (Thai) | rate limit, 500, auth, timeout, context → Thai hint | | |
| 6.3 | Timeout message | `⏱️ AI ใช้เวลานานเกินไป` | | |
| 6.4 | Truncated response | `คำตอบยังไม่ครบ ... พิมพ์ "ต่อ"` | | |
| 6.5 | Session create failure | แจ้ง user ให้ลองใหม่ | | |

## 7. Response Parsing

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 7.1 | Text parts | `p.type === "text"` | | |
| 7.2 | Tool question parts | `p.tool === "question"` → extract question text | | |
| 7.3 | Reasoning fallback | ใช้ reasoning text เมื่อไม่มี text parts | | |
| 7.4 | Empty response | `เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)` | | |

## 8. Web Routes

| # | Route | Method | คำอธิบาย | Status | Notes |
|---|-------|--------|----------|:------:|-------|
| 8.1 | `/` | GET | Health check (plain text) | | |
| 8.2 | `/about` | GET | About page (HTML, dark theme) | | |
| 8.3 | `/webhook` | POST | LINE webhook endpoint | | |

## 9. Infrastructure

| # | Feature | คำอธิบาย | Status | Notes |
|---|---------|----------|:------:|-------|
| 9.1 | 3-container pattern | server + line-bot + cloudflared | | |
| 9.2 | OpenCode REST client | `fetch()` + Basic auth + `x-opencode-directory` | | |
| 9.3 | Wait for server | `waitForOpenCode()` retry loop on startup | | |
| 9.4 | Named tunnel | URL คงที่ (vs quick tunnel เปลี่ยนทุกครั้ง) | | |
| 9.5 | Logging (Bangkok TZ) | `[YYYY-MM-DD HH:MM:SS]` format | | |
| 9.6 | `text.trim()` | trim whitespace ก่อน handle command | | |

## 10. MCP Tools (workspace)

| # | MCP Server | Transport | คำอธิบาย | Status | Notes |
|---|------------|-----------|----------|:------:|-------|
| 10.1 | context7 | remote | Library/framework docs | | |
| 10.2 | gh_grep | remote | GitHub code search | | |
| 10.3 | brave-search | local | Web search (Brave API) | | |

## 11. Workspace Skills

| # | Skill | File | คำอธิบาย | Status | Notes |
|---|-------|------|----------|:------:|-------|
| 11.1 | `/new-prj` | `skill-new-prj.md` | สร้าง project ใหม่ (9 templates) | | |
| 11.2 | `/today` | `skill-today.md` | สรุปข้อมูลประจำวัน (brave-search) | | |

---

## Audit Summary

| หมวด | Total | ✅ | ❌ | ⚠️ |
|------|:-----:|:--:|:--:|:--:|
| 1. Bot Commands | 7 | | | |
| 2. AI / Session | 9 | | | |
| 3. LINE Integration | 10 | | | |
| 4. Group Chat | 6 | | | |
| 5. Context Enrichment | 5 | | | |
| 6. Error Handling | 5 | | | |
| 7. Response Parsing | 4 | | | |
| 8. Web Routes | 3 | | | |
| 9. Infrastructure | 6 | | | |
| 10. MCP Tools | 3 | | | |
| 11. Workspace Skills | 2 | | | |
| **Total** | **70** | | | |

**Audited by:** _______________
**Date:** _______________
**Project:** _______________
**Source:** `src/index.ts` line count: _______________

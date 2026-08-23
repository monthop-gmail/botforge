/**
 * port ของ LINE Messaging API
 *
 * ใช้ `@line/bot-sdk` เป็น **optional peer dependency** ไม่ได้เขียน REST เอง
 * เหตุผล: endpoint ของ LINE ไม่ควรเดาจากความจำ · v1 ใช้ SDK นี้อยู่แล้วและทำงานได้จริง
 * (รูปแบบเดียวกับ `adapter-claude` ที่ห่อ Claude Agent SDK)
 *
 * แยกเป็น port เพื่อให้ test ฉีด fake ได้ — ไม่ต้องมี SDK ไม่ต้องมี channel token
 */

export interface LineTextMessage { type: "text"; text: string }

export interface LineApi {
  replyMessage(args: { replyToken: string; messages: LineTextMessage[] }): Promise<unknown>
  pushMessage(args: { to: string; messages: LineTextMessage[] }): Promise<unknown>
  getProfile(userId: string): Promise<{ displayName?: string; pictureUrl?: string; statusMessage?: string }>
  getGroupMemberProfile(groupId: string, userId: string): Promise<{ displayName?: string; pictureUrl?: string }>
  getGroupSummary(groupId: string): Promise<{ groupName?: string }>
  showLoadingAnimation(args: { chatId: string; loadingSeconds?: number }): Promise<unknown>
  getBotInfo(): Promise<{ userId?: string; displayName?: string }>
}

/**
 * สร้าง client จาก SDK จริง — import แบบ lazy ตอนเรียก
 *
 * v1 ใช้ `new line.messagingApi.MessagingApiClient({ channelAccessToken })`
 */
export async function createLineApi(channelAccessToken: string): Promise<LineApi> {
  let mod: any
  try {
    const specifier = "@line/bot-sdk"
    mod = await import(specifier)
  } catch (err) {
    throw new Error(
      "ไม่พบ @line/bot-sdk — ติดตั้งด้วย `npm i @line/bot-sdk` หรือฉีด api เองผ่าน options.api\n" +
        `สาเหตุเดิม: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return new mod.messagingApi.MessagingApiClient({ channelAccessToken }) as LineApi
}

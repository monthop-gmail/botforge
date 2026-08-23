/**
 * ChannelTransport ของ LINE
 *
 * `reply` ใช้ replyToken ซึ่ง **ฟรีและใช้ได้ครั้งเดียว** · `push` กินโควตา
 * `sendMessage()` ของ core ลอง reply ก่อนแล้ว fallback เป็น push อยู่แล้ว
 * — นี่คือเหตุผลที่ `ChannelTransport` ออกแบบให้มีสองเมธอด
 */
import type { ChannelTransport } from "@botforge/core/channel"
import type { LineApi } from "./api.ts"

export class LineTransport implements ChannelTransport {
  readonly #api: LineApi
  constructor(api: LineApi) { this.#api = api }

  async reply(replyToken: string, text: string): Promise<void> {
    await this.#api.replyMessage({ replyToken, messages: [{ type: "text", text }] })
  }

  async push(to: string, text: string): Promise<void> {
    await this.#api.pushMessage({ to, messages: [{ type: "text", text }] })
  }
}

/** `LineProfileSource` ของ core ต่อกับ Messaging API ตรง ๆ */
export function lineProfileSource(api: LineApi) {
  return {
    getProfile: (userId: string) => api.getProfile(userId),
    getGroupMemberProfile: (groupId: string, userId: string) => api.getGroupMemberProfile(groupId, userId),
    getGroupSummary: (groupId: string) => api.getGroupSummary(groupId),
  }
}

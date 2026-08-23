/**
 * ข้อความที่ bot ส่งเอง — ยกมาจาก v1-final ทุกตัวอักษร
 *
 * `{{...}}` ของ template ถูกแทนด้วย option ตอน runtime แทนที่จะแทนตอน generate
 * — เป็นความต่างเชิงโครงสร้างจาก v1 ที่ใช้ placeholder ในไฟล์
 */
export interface WelcomeOptions {
  botName: string
  lineOaUrl: string
}

/** ส่งตอน bot ถูกเชิญเข้ากลุ่ม — v1 ส่งเฉพาะ group ไม่ส่ง room */
export function welcomeMessage(o: WelcomeOptions): string {
  return `🧑‍💻 สวัสดีครับ! ผม ${o.botName}

💬 พิมพ์อะไรก็ได้ ผมช่วยได้ครับ
📖 พิมพ์ /help ดูคำสั่งทั้งหมด
🔒 คุยส่วนตัว: ${o.lineOaUrl}`
}

/** model ยังไม่มี vision — v1 ตอบเฉพาะ 1:1 ส่วนในกลุ่มเงียบ */
export const NO_VISION_MESSAGE = "ยังดูรูปไม่ได้ครับ ส่งเป็นข้อความแทนนะ"

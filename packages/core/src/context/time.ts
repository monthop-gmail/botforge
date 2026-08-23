/**
 * context เวลา — inject ให้ AI รู้ว่าตอนนี้กี่โมงตามเวลาไทย
 *
 * ยกมาจาก `getTimeContext()` ของ v1-final — **เหมือนกันเชิงความหมายทั้ง 9 engine**
 * (ต่างแค่การจัดบรรทัดกับตัวแปรกลาง)
 */

export const BANGKOK_TZ = "Asia/Bangkok"

const FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: BANGKOK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

/** `[Time: 2026-08-23 14:30:05+07:00]` — รูปแบบเดียวกับ v1 ทุกตัวอักษร */
export function getTimeContext(now: Date = new Date()): string {
  return `[Time: ${FORMATTER.format(now)}+07:00]`
}

/** timestamp สำหรับ log — `[2026-08-23 14:30:05]` เหมือน `log()` ของ v1 */
export function logTimestamp(now: Date = new Date()): string {
  return `[${FORMATTER.format(now)}]`
}

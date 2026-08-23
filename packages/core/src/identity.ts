/**
 * identity/v1 — tenant · workspace · principal
 *
 * ผูกกับ agent-platform `contracts/identity/v1/identity.schema.yaml`
 * ดู docs/architecture/contract-mapping.md §5.1 และ §5.2
 *
 * การตัดสินใจที่ฝังอยู่ในไฟล์นี้ (2026-08-23):
 *   · id ของ channel เป็น `{channel}-{lowercase(rawId)}`
 *     เพราะ LINE id ขึ้นต้นด้วย U/C/R ตัวใหญ่เสมอ ซึ่งผิด ID_PATTERN ทุกตัว
 *     prefix ทำให้รองรับ multi-channel ตั้งแต่ต้นโดยไม่ต้องแก้ id ทีหลัง
 *   · tenant = ลูกค้า · workspace = bot หนึ่งตัว
 *     (ลูกค้ารายเดียวมีหลาย bot ได้ เช่น legal-* มี 5 ตัว)
 */

/** ID_PATTERN ของ identity/v1#/$defs/Id — lowercase ขึ้นต้นด้วย alphanumeric ยาวไม่เกิน 63 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/

export type Id = string
export type TenantId = Id
export type WorkspaceId = Id
export type ActorId = Id

/** channel ที่รองรับ — เพิ่มได้โดยไม่กระทบ id ที่ออกไปแล้ว */
export type ChannelType = "line" | "telegram" | "web" | "discord"

export type PrincipalType = "human" | "agent" | "service"

/** identity/v1#/$defs/Principal */
export interface Principal {
  type: PrincipalType
  id: ActorId
  display_name?: string
  on_behalf_of?: Principal
}

/** identity/v1#/$defs/RequestContext */
export interface RequestContext {
  tenant_id: TenantId
  workspace_id?: WorkspaceId
  principal: Principal
  request_id?: Id
  correlation_id?: Id
}

export function isId(value: string): boolean {
  return ID_PATTERN.test(value)
}

export class InvalidIdError extends Error {
  constructor(value: string, hint: string) {
    super(`ไม่ใช่ identity/v1 Id ที่ถูกต้อง: ${JSON.stringify(value)} — ${hint}`)
    this.name = "InvalidIdError"
  }
}

export function assertId(value: string, what = "id"): Id {
  if (!isId(value)) {
    throw new InvalidIdError(value, `${what} ต้องตรง ${ID_PATTERN.source}`)
  }
  return value
}

/**
 * แปลง id ดิบของ channel ให้เป็น identity/v1 Id
 *
 *   toChannelId("line", "U4af4980629f1b2c3d4e5f6a7b8c9d0e1")
 *     → "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1"
 *
 * เป็น deterministic และย้อนกลับได้ — ตั้งใจไม่ hash เพื่อให้ตามรอยตอน debug ได้
 * LINE id ไม่ถือเป็นความลับในตัวมันเอง แต่ก็ไม่ควรโผล่ใน log ที่แชร์ออกนอกระบบ
 */
export function toChannelId(channel: ChannelType, rawId: string): Id {
  if (rawId.length === 0) throw new InvalidIdError(rawId, "id ดิบว่างเปล่า")
  const id = `${channel}-${rawId.toLowerCase()}`
  if (!isId(id)) {
    throw new InvalidIdError(id, `id ดิบมีอักขระที่ใช้ไม่ได้ หรือยาวเกิน 63 หลังใส่ prefix "${channel}-"`)
  }
  return id
}

/** คืน channel กับ id ดิบจาก id ที่ผ่าน toChannelId มาแล้ว */
export function parseChannelId(id: Id): { channel: string; rawId: string } | null {
  const i = id.indexOf("-")
  if (i <= 0) return null
  return { channel: id.slice(0, i), rawId: id.slice(i + 1) }
}

export function makePrincipal(
  channel: ChannelType,
  rawUserId: string,
  displayName?: string,
): Principal {
  const p: Principal = { type: "human", id: toChannelId(channel, rawUserId) }
  if (displayName !== undefined && displayName !== "") p.display_name = displayName
  return p
}

/**
 * ขอบเขตของ bot หนึ่งตัว
 *
 * ทั้งสองค่า **ต้องประกาศชัด** ห้าม derive จากชื่อ project — ชื่อจริงใน projects/
 * ไม่ได้ตามรูปแบบ `{tenant}-{engine}` เสมอไป (`vithisa-49m` · `legal-services`)
 * และ event/v1 ห้ามเดา tenant ให้ ("reject ที่ intake ห้ามเดา tenant ให้")
 */
export interface Scope {
  tenant_id: TenantId
  workspace_id: WorkspaceId
}

export class MissingScopeError extends Error {
  constructor(missing: string) {
    super(
      `ขาด ${missing} — event/v1 บังคับว่า event ที่ resolve tenant ไม่ได้ต้อง reject ที่ intake ` +
        `ห้ามเดาให้ ตั้งค่า BOTFORGE_TENANT_ID และ BOTFORGE_WORKSPACE_ID`,
    )
    this.name = "MissingScopeError"
  }
}

export function resolveScope(env: Record<string, string | undefined>): Scope {
  const tenant = env.BOTFORGE_TENANT_ID
  const workspace = env.BOTFORGE_WORKSPACE_ID
  if (!tenant) throw new MissingScopeError("BOTFORGE_TENANT_ID")
  if (!workspace) throw new MissingScopeError("BOTFORGE_WORKSPACE_ID")
  return {
    tenant_id: assertId(tenant, "BOTFORGE_TENANT_ID"),
    workspace_id: assertId(workspace, "BOTFORGE_WORKSPACE_ID"),
  }
}

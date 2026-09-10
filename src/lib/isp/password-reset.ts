import { createHash, randomBytes } from "node:crypto";
import { APP_NAME } from "../brand.ts";
import { nid } from "../utils.ts";
import { findAuthUserByEmail, setCredentialPassword } from "./accounts.ts";
import { queueEmail } from "./inbox.ts";
import { issuePortalOtp, setPortalPassword, verifyPortalOtp } from "./portal.ts";
import { applyRls } from "./rls.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const RESET_GENERIC =
  `If that email has an ${APP_NAME} login, we sent a reset link. It expires in 30 minutes.`;

export function hashResetToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("hex");
}

export async function requestOperatorReset(
  sql: Sql,
  email: string,
  origin = "http://localhost:8080",
) {
  await applyRls(sql, { bypass: true });
  const trimmed = email.trim().toLowerCase();
  const generic = { sent: true as const, message: RESET_GENERIC, hint: undefined as string | undefined };
  if (!trimmed.includes("@")) return generic;

  const user = await findAuthUserByEmail(sql, trimmed);
  if (!user) return generic;
  const [cred] = await sql<{ id: string }>`
    select id from account where "userId" = ${user.id} and "providerId" = 'credential'`;
  if (!cred) return generic;

  const recent = await sql<{ n: number }>`
    select count(*)::int as n from password_resets
    where email = ${trimmed} and used = false and created_at > now() - interval '15 minutes'`;
  if ((recent[0]?.n ?? 0) >= 5) return generic;

  const raw = newToken();
  const [mem] = await sql<{ tenant_id: string }>`
    select tenant_id from tenant_members where user_id = ${user.id} limit 1`;
  await sql`insert into password_resets
    (id, audience, email, user_id, tenant_id, token_hash, expires_at)
    values (${nid("rst")}, 'operator', ${trimmed}, ${user.id}, ${mem?.tenant_id ?? null}, ${hashResetToken(raw)}, now() + interval '30 minutes')`;

  const link = `${origin.replace(/\/$/, "")}/reset-password?token=${raw}`;
  let mailed = false;
  if (mem?.tenant_id) {
    const q = await queueEmail(
      sql,
      mem.tenant_id,
      trimmed,
      `Reset your ${APP_NAME} password`,
      `Use this link to set a new password (30 minutes):\n${link}\n\nIf you did not ask for this, ignore the message.`,
    );
    mailed = q.status === "sent";
  }
  return { sent: true as const, message: RESET_GENERIC, hint: mailed ? undefined : link };
}

export async function completeOperatorReset(sql: Sql, token: string, password: string) {
  await applyRls(sql, { bypass: true });
  const hash = hashResetToken(token.trim());
  const [row] = await sql<{ id: string; email: string; user_id: string }>`
    select id, email, user_id from password_resets
    where token_hash = ${hash} and audience = 'operator' and used = false and expires_at > now()`;
  if (!row) throw new Error("This reset link is invalid or has expired.");
  await setCredentialPassword(sql, row.email, password);
  await sql`update password_resets set used = true where id = ${row.id}`;
  await sql`update password_resets set used = true where user_id = ${row.user_id} and used = false`;
  await sql`delete from session where "userId" = ${row.user_id}`;
  return { email: row.email };
}

export async function requestPortalPasswordReset(sql: Sql, slug: string, phone: string) {
  return issuePortalOtp(sql, slug, phone);
}

export async function completePortalPasswordReset(
  sql: Sql,
  opts: { slug: string; phone: string; code: string; password: string },
) {
  const session = await verifyPortalOtp(sql, opts.slug, opts.phone, opts.code);
  await setPortalPassword(sql, session.tenantId, session.customerId, opts.password);
  return session;
}

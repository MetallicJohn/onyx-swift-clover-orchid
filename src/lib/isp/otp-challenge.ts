import { createHash, timingSafeEqual } from "node:crypto";
import { nid } from "../utils.ts";
import { newOtp } from "./otp.ts";
import { applyRls } from "./rls.ts";
import { getRedis } from "./redis.ts";
import { loadOtpPolicy, renderOtpTemplate, sendSms } from "./saas-sms.ts";
import { writePlatformAudit } from "./platform.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const OTP_PURPOSES = ["PASSWORD_RESET", "PHONE_VERIFICATION", "LOGIN_OTP"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

const GENERIC_RESET = "If an account exists for the information provided, a verification code has been sent.";

function pepper() {
  return (process.env.APP_SECRET || process.env.BETTER_AUTH_SECRET || "isp-otp").trim();
}

export function hashOtpCode(id: string, code: string) {
  return createHash("sha256").update(`${pepper()}:${id}:${code}`).digest("hex");
}

function hashesMatch(stored: string, computed: string) {
  const a = Buffer.from(stored);
  const b = Buffer.from(computed);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function hitAuthRateLimit(key: string, max: number, windowSec: number) {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const redisKey = `authlim:${key}:${bucket}`;
  const redis = getRedis();
  const cur = Number((await redis.get(redisKey)) || 0);
  if (cur >= max) return false;
  await redis.set(redisKey, String(cur + 1), windowSec + 5);
  return true;
}

export async function issueOtpChallenge(
  sql: Sql,
  opts: {
    userId: string;
    tenantId?: string | null;
    email: string;
    phone: string;
    purpose: OtpPurpose;
    ip?: string;
    sandbox?: boolean;
  },
) {
  await applyRls(sql, { bypass: true });
  const policy = await loadOtpPolicy(sql);
  const id = nid("otp");
  const code = newOtp(Boolean(opts.sandbox) && policy.sandbox);
  const hash = hashOtpCode(id, code);
  await sql`insert into otp_challenges
    (id, user_id, tenant_id, purpose, phone, email, otp_hash, attempt_count, max_attempts, expires_at, request_ip)
    values (
      ${id}, ${opts.userId}, ${opts.tenantId || null}, ${opts.purpose}, ${opts.phone}, ${opts.email},
      ${hash}, 0, ${policy.maxAttempts}, now() + (${policy.ttlMinutes} * interval '1 minute'), ${opts.ip || ""}
    )`;
  let delivered: { status: string } = { status: "skipped" };
  if (opts.phone && (policy.otpEnabled || opts.sandbox)) {
    const message = renderOtpTemplate(policy.template, code, policy.ttlMinutes);
    delivered = await sendSms(sql, {
      to: opts.phone,
      message,
      messageType: opts.purpose === "PASSWORD_RESET" ? "PASSWORD_RESET_OTP" : "OTP",
      purpose: opts.purpose,
      userId: opts.userId,
      tenantId: opts.tenantId,
    });
  }
  await writePlatformAudit(sql, {
    actorUserId: opts.userId,
    action: "OTP_SENT",
    entityType: "otp_challenge",
    entityId: id,
    tenantId: opts.tenantId,
    metadata: { purpose: opts.purpose, status: delivered.status },
  });
  return { id, ttlMinutes: policy.ttlMinutes, sandbox: Boolean(opts.sandbox) && policy.sandbox, codeForTests: code };
}

export async function verifyOtpChallenge(
  sql: Sql,
  opts: { challengeId?: string; email?: string; phone?: string; purpose: OtpPurpose; code: string; ip?: string },
) {
  await applyRls(sql, { bypass: true });
  const code = String(opts.code || "").replace(/\D/g, "");
  if (code.length !== 6) throw new Error("Enter the 6-digit code");

  let row: {
    id: string;
    user_id: string;
    tenant_id: string | null;
    email: string;
    phone: string;
    otp_hash: string;
    attempt_count: number;
    max_attempts: number;
  } | undefined;

  if (opts.challengeId) {
    [row] = await sql<NonNullable<typeof row>>`
      select id, user_id, tenant_id, email, phone, otp_hash, attempt_count, max_attempts
      from otp_challenges
      where id = ${opts.challengeId} and purpose = ${opts.purpose} and used_at is null and expires_at > now()`;
  } else {
    const email = (opts.email || "").trim().toLowerCase();
    const phone = (opts.phone || "").replace(/\D/g, "").slice(-12);
    [row] = await sql<NonNullable<typeof row>>`
      select id, user_id, tenant_id, email, phone, otp_hash, attempt_count, max_attempts
      from otp_challenges
      where purpose = ${opts.purpose} and used_at is null and expires_at > now()
        and (
          (${email} <> '' and email = ${email})
          or (${phone} <> '' and right(regexp_replace(phone, '\\D', '', 'g'), 9) = right(${phone}, 9))
        )
      order by created_at desc limit 1`;
  }
  if (!row) {
    await writePlatformAudit(sql, {
      actorUserId: "",
      action: "OTP_FAILED",
      entityType: "otp_challenge",
      metadata: { purpose: opts.purpose, reason: "missing_or_expired" },
    });
    throw new Error("Invalid or expired code");
  }
  if (row.attempt_count >= row.max_attempts) {
    await sql`update otp_challenges set used_at = now() where id = ${row.id}`;
    throw new Error("Invalid or expired code");
  }
  const ok = hashesMatch(row.otp_hash, hashOtpCode(row.id, code));
  if (!ok) {
    await sql`update otp_challenges set attempt_count = attempt_count + 1 where id = ${row.id}`;
    await writePlatformAudit(sql, {
      actorUserId: row.user_id,
      action: "OTP_FAILED",
      entityType: "otp_challenge",
      entityId: row.id,
      tenantId: row.tenant_id,
      metadata: { purpose: opts.purpose },
    });
    throw new Error("Invalid or expired code");
  }
  await sql`update otp_challenges set used_at = now(), attempt_count = attempt_count + 1 where id = ${row.id}`;
  await writePlatformAudit(sql, {
    actorUserId: row.user_id,
    action: "OTP_VERIFIED",
    entityType: "otp_challenge",
    entityId: row.id,
    tenantId: row.tenant_id,
    metadata: { purpose: opts.purpose },
  });
  return { userId: row.user_id, tenantId: row.tenant_id, email: row.email, phone: row.phone, challengeId: row.id };
}

export function resetGenericMessage() {
  return GENERIC_RESET;
}

export async function assertOtpNotLogged(source: string) {
  if (/\b\d{6}\b/.test(source) && /otp|verification code/i.test(source)) {
    throw new Error("OTP must not appear in logs");
  }
}

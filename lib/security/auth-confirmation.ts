import type { EmailOtpType } from "@supabase/supabase-js";

const ALLOWED_EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

const ALLOWED_AUTH_DESTINATIONS = new Set(["/teacher"]);

export function isEmailOtpType(value: string | null): value is EmailOtpType {
  return Boolean(value && ALLOWED_EMAIL_OTP_TYPES.has(value));
}

export function safeAuthDestination(value: string | null | undefined): string {
  return value && ALLOWED_AUTH_DESTINATIONS.has(value) ? value : "/teacher";
}

export function isExpiredAuthQuery(params: Record<string, string | string[] | undefined>): boolean {
  const errorCode = Array.isArray(params.error_code) ? params.error_code[0] : params.error_code;
  return errorCode === "otp_expired";
}

export function maskEmail(email: string): string {
  const [local, domain] = email.trim().split("@");
  if (!local || !domain) return email.trim();
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

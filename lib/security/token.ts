import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { QR_CLOCK_TOLERANCE_MS, QR_TOKEN_LIFETIME_MS } from "@/lib/qr/constants";
export { QR_CLOCK_TOLERANCE_MS, QR_TOKEN_LIFETIME_MS };
export const REGISTRATION_GRANT_LIFETIME_MS = 10 * 60_000;

type TokenKind = "qr" | "registration";

export interface SignedTokenPayload {
  version: 1;
  kind: TokenKind;
  session_id: string;
  issued_at: number;
  expiration: number;
  nonce: string;
  device_hash?: string;
}

export type TokenValidation =
  | { valid: true; payload: SignedTokenPayload }
  | { valid: false; reason: "invalid" | "expired" };

function signingSecret(): string {
  const secret = process.env.QR_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("QR_SIGNING_SECRET debe contener al menos 32 bytes.");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createSignedToken(
  sessionId: string,
  kind: TokenKind = "qr",
  now = Date.now(),
  deviceHash?: string,
): string {
  const lifetime =
    kind === "qr" ? QR_TOKEN_LIFETIME_MS : REGISTRATION_GRANT_LIFETIME_MS;
  const payload: SignedTokenPayload = {
    version: 1,
    kind,
    session_id: sessionId,
    issued_at: now,
    expiration: now + lifetime,
    nonce: randomBytes(16).toString("base64url"),
    ...(kind === "registration" && deviceHash ? { device_hash: deviceHash } : {}),
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function isPayload(value: unknown, expectedKind: TokenKind): value is SignedTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SignedTokenPayload>;
  return (
    payload.version === 1 &&
    payload.kind === expectedKind &&
    typeof payload.session_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      payload.session_id,
    ) &&
    typeof payload.issued_at === "number" &&
    Number.isSafeInteger(payload.issued_at) &&
    typeof payload.expiration === "number" &&
    Number.isSafeInteger(payload.expiration) &&
    payload.expiration > payload.issued_at &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 16
  );
}

export function verifySignedToken(
  token: string,
  expectedKind: TokenKind = "qr",
  now = Date.now(),
): TokenValidation {
  try {
    const [encodedPayload, providedSignature, extra] = token.split(".");
    if (!encodedPayload || !providedSignature || extra) {
      return { valid: false, reason: "invalid" };
    }

    const expectedSignature = Buffer.from(sign(encodedPayload), "base64url");
    const actualSignature = Buffer.from(providedSignature, "base64url");
    if (
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      return { valid: false, reason: "invalid" };
    }

    const parsed: unknown = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    if (!isPayload(parsed, expectedKind)) {
      return { valid: false, reason: "invalid" };
    }

    const maximumLifetime =
      expectedKind === "qr"
        ? QR_TOKEN_LIFETIME_MS
        : REGISTRATION_GRANT_LIFETIME_MS;
    if (parsed.expiration - parsed.issued_at !== maximumLifetime) {
      return { valid: false, reason: "invalid" };
    }
    if (parsed.issued_at > now + QR_CLOCK_TOLERANCE_MS) {
      return { valid: false, reason: "invalid" };
    }
    if (now > parsed.expiration + QR_CLOCK_TOLERANCE_MS) {
      return { valid: false, reason: "expired" };
    }

    return { valid: true, payload: parsed };
  } catch {
    return { valid: false, reason: "invalid" };
  }
}

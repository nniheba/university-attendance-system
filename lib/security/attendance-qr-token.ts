import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { QR_CLOCK_TOLERANCE_MS, QR_TOKEN_LIFETIME_MS } from "@/lib/qr/constants";

const TOKEN_VERSION = "q2";
const UUID_BYTES = 16;
const NONCE_BYTES = 12;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const TIMESTAMP_PATTERN = /^[0-9a-z]{8,10}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface AttendanceQrTokenPayload {
  version: 2;
  kind: "qr";
  session_id: string;
  issued_at: number;
  expiration: number;
  nonce: string;
}

export type AttendanceQrTokenValidation =
  | { valid: true; payload: AttendanceQrTokenPayload }
  | { valid: false; reason: "invalid" | "expired" };

function signingSecret(): string {
  const secret = process.env.QR_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("QR_SIGNING_SECRET debe contener al menos 32 bytes.");
  }
  return secret;
}

function sign(material: string): string {
  return createHmac("sha256", signingSecret()).update(material).digest("base64url");
}

function uuidToCompact(uuid: string): string {
  const normalized = uuid.toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error("Session id is not a valid UUID.");
  return Buffer.from(normalized.replaceAll("-", ""), "hex").toString("base64url");
}

function compactToUuid(compact: string): string | null {
  if (!SESSION_PATTERN.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64url");
  if (bytes.length !== UUID_BYTES || bytes.toString("base64url") !== compact) return null;
  const hex = bytes.toString("hex");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_PATTERN.test(uuid) ? uuid : null;
}

export function createAttendanceQrToken(sessionId: string, now = Date.now()): string {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > Number.MAX_SAFE_INTEGER - QR_TOKEN_LIFETIME_MS
  ) throw new Error("Invalid QR issue time.");
  const session = uuidToCompact(sessionId);
  const timestamp = now.toString(36);
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  const material = `${TOKEN_VERSION}.${session}.${timestamp}.${nonce}`;
  return `${material}.${sign(material)}`;
}

export function verifyAttendanceQrToken(
  token: string,
  now = Date.now(),
): AttendanceQrTokenValidation {
  try {
    const [version, compactSession, timestamp, nonce, providedSignature, extra] = token.split(".");
    if (
      version !== TOKEN_VERSION ||
      !compactSession ||
      !timestamp ||
      !nonce ||
      !providedSignature ||
      extra ||
      !SESSION_PATTERN.test(compactSession) ||
      !TIMESTAMP_PATTERN.test(timestamp) ||
      !NONCE_PATTERN.test(nonce) ||
      !SIGNATURE_PATTERN.test(providedSignature)
    ) {
      return { valid: false, reason: "invalid" };
    }

    const material = `${version}.${compactSession}.${timestamp}.${nonce}`;
    const expectedSignature = Buffer.from(sign(material), "base64url");
    const actualSignature = Buffer.from(providedSignature, "base64url");
    if (
      actualSignature.toString("base64url") !== providedSignature ||
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      return { valid: false, reason: "invalid" };
    }

    // Decode and trust compact fields only after authenticating their exact bytes.
    const sessionId = compactToUuid(compactSession);
    const issuedAt = Number.parseInt(timestamp, 36);
    if (
      !sessionId ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0 ||
      issuedAt > Number.MAX_SAFE_INTEGER - QR_TOKEN_LIFETIME_MS ||
      issuedAt.toString(36) !== timestamp
    ) {
      return { valid: false, reason: "invalid" };
    }
    if (issuedAt > now + QR_CLOCK_TOLERANCE_MS) {
      return { valid: false, reason: "invalid" };
    }
    const expiration = issuedAt + QR_TOKEN_LIFETIME_MS;
    if (now > expiration + QR_CLOCK_TOLERANCE_MS) {
      return { valid: false, reason: "expired" };
    }

    return {
      valid: true,
      payload: {
        version: 2,
        kind: "qr",
        session_id: sessionId,
        issued_at: issuedAt,
        expiration,
        nonce,
      },
    };
  } catch {
    return { valid: false, reason: "invalid" };
  }
}

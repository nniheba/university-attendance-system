import { beforeAll, describe, expect, it } from "vitest";
import {
  createSignedToken,
  QR_CLOCK_TOLERANCE_MS,
  QR_TOKEN_LIFETIME_MS,
  verifySignedToken,
  REGISTRATION_GRANT_LIFETIME_MS,
} from "@/lib/security/token";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = 1_800_000_000_000;

beforeAll(() => {
  process.env.QR_SIGNING_SECRET = "test-secret-with-more-than-thirty-two-bytes-long";
});

describe("signed QR tokens", () => {
  it("uses exactly 4000 ms with only 750 ms of operational tolerance", () => {
    expect(QR_TOKEN_LIFETIME_MS).toBe(4000);
    expect(QR_CLOCK_TOLERANCE_MS).toBe(750);
    const token = createSignedToken(SESSION_ID, "qr", NOW);
    const result = verifySignedToken(token, "qr", NOW + 3999);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.expiration - result.payload.issued_at).toBe(4000);
    expect(verifySignedToken(token, "qr", NOW + 4750).valid).toBe(true);
    expect(verifySignedToken(token, "qr", NOW + 4751)).toEqual({ valid: false, reason: "expired" });
  });

  it("keeps the 10-minute grant and binds it to a signed device hash", () => {
    expect(REGISTRATION_GRANT_LIFETIME_MS).toBe(600000);
    const hash = "a".repeat(64);
    const token = createSignedToken(SESSION_ID, "registration", NOW, hash);
    const result = verifySignedToken(token, "registration", NOW + 599999);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.device_hash).toBe(hash);
    expect(verifySignedToken(token, "qr", NOW).valid).toBe(false);
    expect(verifySignedToken(token, "registration", NOW + 602001).valid).toBe(false);
  });
  it("accepts a newly generated token", () => {
    const token = createSignedToken(SESSION_ID, "qr", NOW);
    const result = verifySignedToken(token, "qr", NOW + 1_000);

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.session_id).toBe(SESSION_ID);
  });

  it("uses a new cryptographic nonce for every QR", () => {
    const first = verifySignedToken(createSignedToken(SESSION_ID, "qr", NOW), "qr", NOW);
    const second = verifySignedToken(createSignedToken(SESSION_ID, "qr", NOW), "qr", NOW);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    if (first.valid && second.valid) expect(first.payload.nonce).not.toBe(second.payload.nonce);
  });

  it("rejects a token beyond its expiration and clock tolerance", () => {
    const token = createSignedToken(SESSION_ID, "qr", NOW);
    const result = verifySignedToken(
      token,
      "qr",
      NOW + QR_TOKEN_LIFETIME_MS + QR_CLOCK_TOLERANCE_MS + 1,
    );

    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a manipulated token", () => {
    const token = createSignedToken(SESSION_ID, "qr", NOW);
    const [payload, signature] = token.split(".");
    const manipulated = `${payload.slice(0, -1)}A.${signature}`;

    expect(verifySignedToken(manipulated, "qr", NOW)).toEqual({
      valid: false,
      reason: "invalid",
    });
  });
});

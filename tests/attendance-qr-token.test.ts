import { beforeAll, describe, expect, it } from "vitest";

import {
  createAttendanceQrToken,
  verifyAttendanceQrToken,
} from "@/lib/security/attendance-qr-token";
import { extractAttendanceToken } from "@/lib/attendance/scan";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = 1_800_000_000_000;

beforeAll(() => {
  process.env.QR_SIGNING_SECRET = "test-secret-with-more-than-thirty-two-bytes-long";
});

function replaceSegment(token: string, index: number, value: string): string {
  const segments = token.split(".");
  segments[index] = value;
  return segments.join(".");
}

function flip(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

describe("compact attendance QR token v2", () => {
  it("round-trips a valid UUID with full HMAC-SHA256 authentication", () => {
    const token = createAttendanceQrToken(SESSION_ID, NOW);
    const result = verifyAttendanceQrToken(token, NOW + 1_000);
    expect(token.split(".")).toHaveLength(5);
    expect(token.split(".").at(-1)).toHaveLength(43);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toMatchObject({
        version: 2,
        session_id: SESSION_ID,
        issued_at: NOW,
        expiration: NOW + 4_000,
      });
    }
  });

  it("keeps the exact four-second lifetime and 750 ms tolerance", () => {
    const token = createAttendanceQrToken(SESSION_ID, NOW);
    expect(verifyAttendanceQrToken(token, NOW + 4_750).valid).toBe(true);
    expect(verifyAttendanceQrToken(token, NOW + 4_751)).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects future timestamps", () => {
    const token = createAttendanceQrToken(SESSION_ID, NOW + 751);
    expect(verifyAttendanceQrToken(token, NOW)).toEqual({ valid: false, reason: "invalid" });
  });

  it.each([
    ["session", 1],
    ["timestamp", 2],
    ["nonce", 3],
    ["signature", 4],
  ])("rejects a tampered %s", (_name, segment) => {
    const token = createAttendanceQrToken(SESSION_ID, NOW);
    const value = token.split(".")[segment];
    expect(verifyAttendanceQrToken(replaceSegment(token, segment, flip(value)), NOW)).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  it("rejects truncated tokens and extra fields", () => {
    const token = createAttendanceQrToken(SESSION_ID, NOW);
    expect(verifyAttendanceQrToken(token.slice(0, -4), NOW).valid).toBe(false);
    expect(verifyAttendanceQrToken(`${token}.extra`, NOW).valid).toBe(false);
  });

  it("accepts the exact legacy prefix and only trusted attendance URLs", () => {
    const token = createAttendanceQrToken(SESSION_ID, NOW);
    expect(extractAttendanceToken(`attendance:${token}`)).toBe(token);
    expect(extractAttendanceToken(`other:${token}`)).toBeNull();
    expect(extractAttendanceToken(`attendance:extra.${token}`)).toBeNull();
    expect(extractAttendanceToken("https://preview.example/attendance/legacy.signature", ["https://preview.example"])).toBe("legacy.signature");
    expect(extractAttendanceToken("https://wrong.example/attendance/legacy.signature", ["https://preview.example"])).toBeNull();
  });
});

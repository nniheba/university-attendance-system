import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applicationOrigin } from "@/lib/qr/application-origin";
import {
  attendanceQrTrustedOrigins,
  attendanceQrUrl,
  parseAttendanceQrValue,
} from "@/lib/qr/attendance-value";
import {
  ATTENDANCE_SCAN_DESTINATION,
  attendanceLoginUrl,
  safeAttendanceIntent,
} from "@/lib/security/attendance-intent";

const ORIGIN = "https://attendance-preview.example";
const OTHER_ORIGIN = "https://evil.example";
const TOKEN = `q2.AAAAAAAAAAAAAAAAAAAAAA.mmx12345.AAAAAAAAAAAAAAAA.${"A".repeat(43)}`;

describe("v0.6.5.1 unified attendance QR", () => {
  it("uses the configured application origin and falls back to the request origin", () => {
    expect(applicationOrigin("https://request.example/api/qr", "https://canonical.example/path")).toBe("https://canonical.example");
    expect(applicationOrigin("https://request.example/api/qr", "")).toBe("https://request.example");
    expect(applicationOrigin("https://request.example/api/qr", "javascript:alert(1)")).toBe("https://request.example");
  });

  it("builds the absolute attendance path without changing the signed token", () => {
    const value = attendanceQrUrl(`${ORIGIN}/ignored`, TOKEN);
    expect(value).toBe(`${ORIGIN}/attendance/${TOKEN}`);
    expect(new URL(value).protocol).toBe("https:");
    expect(parseAttendanceQrValue(value, { trustedOrigins: [ORIGIN] })).toEqual({ token: TOKEN });
  });

  it.each([
    ["wrong origin", `${OTHER_ORIGIN}/attendance/${TOKEN}`],
    ["wrong path", `${ORIGIN}/login/${TOKEN}`],
    ["query injection", `${ORIGIN}/attendance/${TOKEN}?next=${TOKEN}`],
    ["javascript", "javascript:alert(1)"],
    ["data", `data:text/plain,${TOKEN}`],
    ["file", `file:///attendance/${TOKEN}`],
    ["malformed", "https://%"],
    ["empty", "   "],
  ])("rejects %s scanned values", (_case, value) => {
    expect(parseAttendanceQrValue(value, { trustedOrigins: [ORIGIN], allowLegacyRawToken: true })).toBeNull();
  });

  it("retains exact raw-token compatibility only when explicitly enabled", () => {
    expect(parseAttendanceQrValue(TOKEN, { trustedOrigins: [ORIGIN] })).toBeNull();
    expect(parseAttendanceQrValue(TOKEN, { trustedOrigins: [ORIGIN], allowLegacyRawToken: true })).toEqual({ token: TOKEN });
    expect(parseAttendanceQrValue(`attendance:${TOKEN}`, { trustedOrigins: [ORIGIN], allowLegacyRawToken: true })).toEqual({ token: TOKEN });
    expect(parseAttendanceQrValue(`custom:${TOKEN}`, { trustedOrigins: [ORIGIN], allowLegacyRawToken: true })).toBeNull();
  });

  it("trusts only the exact current and intentionally configured origins", () => {
    expect(attendanceQrTrustedOrigins(ORIGIN, "https://official.example/path")).toEqual([
      ORIGIN,
      "https://official.example",
    ]);
  });

  it("allows only the fixed attendance login intent and never carries a QR token", () => {
    expect(safeAttendanceIntent(ATTENDANCE_SCAN_DESTINATION)).toBe(ATTENDANCE_SCAN_DESTINATION);
    expect(safeAttendanceIntent("https://evil.example")).toBeNull();
    expect(safeAttendanceIntent("//evil.example")).toBeNull();
    expect(safeAttendanceIntent(`/attendance/${TOKEN}`)).toBeNull();
    expect(attendanceLoginUrl()).toBe("/login?next=%2Fstudent%2Fscan%3Fintent%3Dattendance");
    expect(attendanceLoginUrl()).not.toContain(TOKEN);
  });

  it("keeps camera permission available only to this app", () => {
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(config).toContain("camera=(self)");
    expect(config).toContain("microphone=()");
    expect(config).not.toContain("camera=()");
  });
});

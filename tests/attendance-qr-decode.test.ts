import { beforeAll, describe, expect, it } from "vitest";

import { extractAttendanceToken } from "@/lib/attendance/scan";
import { attendanceQrUrl } from "@/lib/qr/attendance-value";
import { createAttendanceQrToken } from "@/lib/security/attendance-qr-token";
import { createSignedToken } from "@/lib/security/token";
import {
  decodeWithQrScanner,
  qrModuleVersion,
  renderQrImage,
  slightlyBlurred,
} from "@/tests/helpers/qr-decoder";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = 1_800_000_000_000;
const PREVIEW_ORIGIN = "https://attendance-preview.example";

beforeAll(() => {
  process.env.QR_SIGNING_SECRET = "test-secret-with-more-than-thirty-two-bytes-long";
});

describe("projected compact QR acquisition", () => {
  it("decodes the simple HELLO_ATTENDANCE diagnostic QR", () => {
    expect(decodeWithQrScanner(renderQrImage("HELLO_ATTENDANCE", 400))).toBe("HELLO_ATTENDANCE");
    expect(extractAttendanceToken("HELLO_ATTENDANCE")).toBeNull();
  });

  it.each([720, 540, 400, 360, 252, 250])(
    "decodes the exact projected payload at %ipx",
    (width) => {
      const token = createAttendanceQrToken(SESSION_ID, NOW);
      const projectedValue = attendanceQrUrl(PREVIEW_ORIGIN, token);
      const decoded = decodeWithQrScanner(renderQrImage(projectedValue, width));
      expect(decoded).toBe(projectedValue);
      expect(extractAttendanceToken(decoded!, [PREVIEW_ORIGIN])).toBe(token);
    },
  );

  it("decodes a slightly blurred physical-like image", () => {
    const token = createAttendanceQrToken(SESSION_ID, NOW);
    const projectedValue = attendanceQrUrl(PREVIEW_ORIGIN, token);
    const decoded = decodeWithQrScanner(slightlyBlurred(renderQrImage(projectedValue, 400)));
    expect(decoded).toBe(projectedValue);
    expect(extractAttendanceToken(decoded!, [PREVIEW_ORIGIN])).toBe(token);
  });

  it("materially reduces payload length and QR density without truncating HMAC", () => {
    const oldToken = createSignedToken(SESSION_ID, "qr", NOW);
    const oldValue = `${PREVIEW_ORIGIN}/attendance/${oldToken}`;
    const newToken = createAttendanceQrToken(SESSION_ID, NOW);
    const newValue = attendanceQrUrl(PREVIEW_ORIGIN, newToken);
    const oldQr = qrModuleVersion(oldValue);
    const newQr = qrModuleVersion(newValue);

    expect(oldValue.length).toBe(PREVIEW_ORIGIN.length + "/attendance/".length + oldToken.length);
    expect(oldToken.length).toBeGreaterThan(newToken.length + 100);
    expect(newValue.length).toBeLessThan(oldValue.length);
    expect(newQr.version).toBeLessThan(oldQr.version);
    expect(newQr.modules).toBeLessThan(oldQr.modules);
    expect(newToken.split(".").at(-1)).toHaveLength(43);
  });
});

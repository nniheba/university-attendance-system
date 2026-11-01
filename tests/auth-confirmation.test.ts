import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isEmailOtpType,
  isExpiredAuthQuery,
  maskEmail,
  safeAuthDestination,
} from "@/lib/security/auth-confirmation";

describe("authentication confirmation helpers", () => {
  it("accepts supported email OTP types", () => {
    expect(isEmailOtpType("email")).toBe(true);
    expect(isEmailOtpType("signup")).toBe(true);
    expect(isEmailOtpType("unknown")).toBe(false);
  });

  it("accepts only explicit internal destinations", () => {
    expect(safeAuthDestination("/teacher")).toBe("/teacher");
    expect(safeAuthDestination("https://evil.example")).toBe("/teacher");
    expect(safeAuthDestination("//evil.example")).toBe("/teacher");
    expect(safeAuthDestination("/attendance/token")).toBe("/teacher");
  });

  it("recognizes old expired confirmation query parameters", () => {
    expect(isExpiredAuthQuery({ error: "access_denied", error_code: "otp_expired" })).toBe(true);
    expect(isExpiredAuthQuery({ error_code: "other" })).toBe(false);
  });

  it("masks email without storing it in a URL", () => {
    expect(maskEmail("profesora@faculty.example.edu")).toBe("pr•••••••@faculty.example.edu");
  });

  it("keeps legacy confirmation isolated from the active password login UI", () => {
    const source = readFileSync(new URL("../components/login-form.tsx", import.meta.url), "utf8");
    expect(source).toContain("/api/auth/sign-in");
    expect(source).toContain("/api/auth/sign-up");
    expect(source).not.toContain("confirmation");
    expect(source).not.toContain("one-time-code");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("http://localhost:3000");
  });
});

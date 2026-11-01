import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createServerAuthClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

import { GET } from "@/app/auth/confirm/route";

function request(query: string) {
  return new NextRequest(`https://preview.example/auth/confirm?${query}`);
}

describe("GET /auth/confirm", () => {
  beforeEach(() => verifyOtp.mockReset());

  it("verifies a valid token hash and redirects to teacher without token parameters", async () => {
    verifyOtp.mockResolvedValue({ data: { session: { access_token: "not-exposed" } }, error: null });
    const response = await GET(request("token_hash=valid&type=email&next=%2Fteacher"));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "valid", type: "email" });
    expect(response.headers.get("location")).toBe("https://preview.example/teacher");
    expect(response.headers.get("location")).not.toContain("token_hash");
  });

  it("exchanges a recovery token and redirects to the password reset form", async () => {
    verifyOtp.mockResolvedValue({ data: { session: { access_token: "not-exposed" } }, error: null });
    const response = await GET(request("token_hash=recovery-hash&type=recovery"));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "recovery-hash", type: "recovery" });
    expect(response.headers.get("location")).toBe("https://preview.example/reset-password");
    expect(response.headers.get("set-cookie")).toContain("password_recovery_v1=1");
    expect(response.headers.get("location")).not.toContain("token_hash");
  });

  it("ignores an unsafe next destination", async () => {
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    const response = await GET(request("token_hash=valid&type=email&next=https%3A%2F%2Fevil.example"));
    expect(response.headers.get("location")).toBe("https://preview.example/teacher");
  });

  it("redirects invalid or expired verification to a sanitized login state", async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error("expired") });
    const response = await GET(request("token_hash=expired&type=email"));
    expect(response.headers.get("location")).toBe("https://preview.example/login?confirmation=expired");
  });

  it("shows confirmed login state when verification succeeds without a session", async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    const response = await GET(request("token_hash=valid&type=email"));
    expect(response.headers.get("location")).toBe("https://preview.example/login?confirmed=1");
  });

  it("rejects an unsupported OTP type before contacting Supabase", async () => {
    const response = await GET(request("token_hash=valid&type=admin"));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://preview.example/login?confirmation=expired");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const resetPasswordForEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createServerAuthClient: async () => ({ auth: { resetPasswordForEmail } }),
}));

import { POST } from "@/app/api/auth/forgot-password/route";

function request(email: string) {
  return new Request("https://preview.example/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  vi.restoreAllMocks();
});

describe("institutional password recovery", () => {
  it.each([
    "student@students.example.edu",
    "teacher@faculty.example.edu",
  ])("requests a recovery link for %s using the current origin", async (email) => {
    const response = await POST(request(email));
    expect(response.status).toBe(200);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(email, {
      redirectTo: "https://preview.example/reset-password",
    });
  });

  it("prefers the configured canonical application origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://attendance.example.edu/path/";
    await POST(request("student@students.example.edu"));
    expect(resetPasswordForEmail).toHaveBeenCalledWith("student@students.example.edu", {
      redirectTo: "https://attendance.example.edu/reset-password",
    });
  });

  it("rejects non-institutional email", async () => {
    expect((await POST(request("person@gmail.com"))).status).toBe(400);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("returns generic success and logs only safe diagnostics when the provider rejects the request", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetPasswordForEmail.mockResolvedValue({
      error: Object.assign(new Error("Email address not authorized: unknown@students.example.edu"), {
        code: "email_address_not_authorized",
        status: 500,
      }),
    });
    const response = await POST(request("unknown@students.example.edu"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: "Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.",
    });
    expect(log).toHaveBeenCalledWith("Password recovery provider rejected the request", {
      name: "Error",
      code: "email_address_not_authorized",
      status: 500,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("unknown@students.example.edu");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Email address not authorized");
  });

  it("returns the same generic success for an unknown account", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: new Error("User not found") });
    const response = await POST(request("unknown@students.example.edu"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: "Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.",
    });
  });

  it("requires a recovery exchange, validates passwords and forces a fresh login", () => {
    const source = readFileSync(new URL("../components/reset-password-form.tsx", import.meta.url), "utf8");
    expect(source).toContain("exchangeCodeForSession(code)");
    expect(source).toContain('setState(error ? "invalid" : "valid")');
    expect(source).toContain("password.length < INSTITUTIONAL_PASSWORD_MIN_LENGTH");
    expect(source).toContain("password !== confirmation");
    expect(source).toContain("supabase.auth.updateUser({ password })");
    expect(source).toContain("supabase.auth.signOut()");
  });
});

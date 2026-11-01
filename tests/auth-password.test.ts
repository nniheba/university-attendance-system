import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSTITUTIONAL_PASSWORD_MIN_LENGTH,
  institutionalPasswordsMatch,
} from "@/lib/security/institutional-password";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
const bootstrap = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createServerAuthClient: async () => ({ auth }),
}));
vi.mock("@/lib/security/institutional-auth", () => ({
  bootstrapInstitutionalAccount: bootstrap,
  isTeacherAccessNotAuthorized: (error: unknown) =>
    error instanceof Error && error.message === "TEACHER_ACCESS_NOT_AUTHORIZED",
}));

import { POST as signIn } from "@/app/api/auth/sign-in/route";
import { POST as signUp } from "@/app/api/auth/sign-up/route";

const studentUser = { id: "student-a", email: "person@students.example.edu" };
const teacherUser = { id: "teacher-a", email: "teacher.one@faculty.example.edu" };
const session = { access_token: "private" };

function request(path: string, body: Record<string, unknown>) {
  return new Request(`https://attendance.example/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.signInWithPassword.mockResolvedValue({ data: { user: studentUser, session }, error: null });
  auth.signUp.mockResolvedValue({ data: { user: studentUser, session }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  bootstrap.mockResolvedValue({ account: { role: "student" } });
});

describe("institutional password authentication", () => {
  it("normalizes a student email, signs up and establishes the student destination", async () => {
    const response = await signUp(request("sign-up", {
      email: " Person@STUDENTS.EXAMPLE.EDU ",
      password: "secure-pass",
    }));

    expect(response.status).toBe(200);
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "person@students.example.edu",
      password: "secure-pass",
    });
    expect(bootstrap).toHaveBeenCalledWith(studentUser);
    expect(await response.json()).toMatchObject({ role: "student", destination: "/student?ready=1" });
  });

  it("signs in an existing student with password and bootstraps the SSR session", async () => {
    const response = await signIn(request("sign-in", {
      email: "person@students.example.edu",
      password: "secure-pass",
    }));

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@students.example.edu",
      password: "secure-pass",
    });
    expect(bootstrap).toHaveBeenCalledWith(studentUser);
    expect(await response.json()).toMatchObject({ role: "student", destination: "/student?ready=1" });
  });

  it("routes an allowlisted teacher identity returned by the server bootstrap", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: teacherUser, session }, error: null });
    bootstrap.mockResolvedValue({ account: { role: "teacher" } });

    const response = await signIn(request("sign-in", {
      email: "teacher.one@faculty.example.edu",
      password: "secure-pass",
    }));

    expect(await response.json()).toMatchObject({ role: "teacher", destination: "/teacher" });
  });

  it("creates an allowlisted teacher account without accepting a browser-supplied role", async () => {
    auth.signUp.mockResolvedValue({ data: { user: teacherUser, session }, error: null });
    bootstrap.mockResolvedValue({ account: { role: "teacher" } });

    const response = await signUp(request("sign-up", {
      email: "teacher.one@faculty.example.edu",
      password: "secure-pass",
      role: "student",
    }));

    expect(bootstrap).toHaveBeenCalledWith(teacherUser);
    expect(await response.json()).toMatchObject({ role: "teacher", destination: "/teacher" });
  });

  it.each([signIn, signUp])("denies a non-allowlisted teacher-domain account safely", async (handler) => {
    bootstrap.mockRejectedValue(new Error("TEACHER_ACCESS_NOT_AUTHORIZED"));
    const response = await handler(request("password", {
      email: "person@faculty.example.edu",
      password: "secure-pass",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "TEACHER_ACCESS_NOT_AUTHORIZED",
      message: "Tu cuenta institucional no tiene acceso docente autorizado.",
    });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    "person@gmail.com",
    "person@subdomain.faculty.example.edu",
    "person@faculty.example.edu.evil.com",
    "person@fake.students.example.edu",
    "person@students.example.edu.evil.com",
  ])("rejects %s before contacting Supabase Auth", async (email) => {
    const response = await signUp(request("sign-up", { email, password: "secure-pass" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_INSTITUTIONAL_EMAIL");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it.each([signIn, signUp])("enforces the eight-character minimum on the server", async (handler) => {
    const response = await handler(request("password", {
      email: "person@students.example.edu",
      password: "1234567",
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_PASSWORD");
    expect(INSTITUTIONAL_PASSWORD_MIN_LENGTH).toBe(8);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("requires matching password confirmation in the registration form", () => {
    expect(institutionalPasswordsMatch("secure-pass", "secure-pass")).toBe(true);
    expect(institutionalPasswordsMatch("secure-pass", "different-pass")).toBe(false);
  });

  it("returns a generic sign-in error without exposing account existence", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials: internal provider detail" },
    });
    const response = await signIn(request("sign-in", {
      email: "missing@students.example.edu",
      password: "wrong-pass",
    }));
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "INVALID_CREDENTIALS", message: "El correo o la contraseña no son correctos." });
    expect(JSON.stringify(body)).not.toContain("provider detail");
  });

  it("fails closed when Confirm email prevents an immediate sign-up session", async () => {
    auth.signUp.mockResolvedValue({ data: { user: studentUser, session: null }, error: null });
    const response = await signUp(request("sign-up", {
      email: "person@students.example.edu",
      password: "secure-pass",
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("EMAIL_CONFIRMATION_REQUIRED");
    expect(bootstrap).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out an authenticated session when account bootstrap fails", async () => {
    bootstrap.mockRejectedValue(new Error("database unavailable"));
    const response = await signIn(request("sign-in", {
      email: "person@students.example.edu",
      password: "secure-pass",
    }));
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("ACCOUNT_BOOTSTRAP_FAILED");
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("uses the password endpoints, secure autocomplete and no OTP or local token UI", () => {
    const source = readFileSync(new URL("../components/login-form.tsx", import.meta.url), "utf8");
    expect(source).toContain("/api/auth/sign-in");
    expect(source).toContain("/api/auth/sign-up");
    expect(source).toContain('autoComplete="new-password"');
    expect(source).toContain('"current-password"');
    expect(source).not.toContain("/api/auth/request-code");
    expect(source).not.toContain("/api/auth/verify-code");
    expect(source).not.toContain("one-time-code");
    expect(source).not.toContain("ENVIAR CÓDIGO");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain('name="role"');
  });

  it("keeps Supabase sessions in SSR cookies rather than browser storage", () => {
    const source = readFileSync(new URL("../lib/supabase/server.ts", import.meta.url), "utf8");
    expect(source).toContain("createServerClient");
    expect(source).toContain("cookieStore.getAll()");
    expect(source).toContain("cookieStore.set(");
    expect(source).not.toContain("localStorage");
  });
});

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({
  authenticated: false,
  denialStatus: 401,
  ownsClass: false,
  teacherOwnsClass: vi.fn(),
  user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
}));
const database = vi.hoisted(() => ({
  account: { user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } as { user_id: string } | null,
  enrollment: {
    student_email: "student@students.example.edu",
    student_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  } as { student_email: string; student_user_id: string | null } | null,
  filters: [] as Array<[string, string, unknown]>,
}));
const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => authorization.authenticated
    ? { authenticated: true, user: authorization.user }
    : {
        authenticated: false,
        response: Response.json(
          { code: authorization.denialStatus === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
          { status: authorization.denialStatus },
        ),
      },
  teacherOwnsClass: authorization.teacherOwnsClass,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { POST as resetTrustedDevice } from "@/app/api/teacher/student-device/reset/route";
import { resetStudentAccount } from "@/lib/academic/student-account-reset";

const classId = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "22222222-2222-4222-8222-222222222222";
const email = "student@students.example.edu";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function request(body: Record<string, unknown>) {
  return new Request("https://test.invalid/api/teacher/student-device/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authorization.authenticated = false;
  authorization.denialStatus = 401;
  authorization.ownsClass = false;
  authorization.teacherOwnsClass.mockImplementation(async () => authorization.ownsClass);
  database.account = { user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
  database.enrollment = {
    student_email: email,
    student_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  };
  database.filters = [];
  admin.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((field: string, value: unknown) => {
        database.filters.push([table, field, value]);
        return query;
      }),
      maybeSingle: vi.fn(async () => ({
        data: table === "class_enrollments" ? database.enrollment : database.account,
        error: null,
      })),
    };
    return query;
  });
  admin.rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("student account reset API", () => {
  it("rejects unauthenticated and non-teacher callers", async () => {
    expect((await resetTrustedDevice(request({ email }))).status).toBe(401);
    authorization.denialStatus = 403;
    expect((await resetTrustedDevice(request({ email }))).status).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("keeps the legacy manual email reset flow working without class context", async () => {
    authorization.authenticated = true;
    const response = await resetTrustedDevice(request({ email: `  ${email.toUpperCase()}  ` }));

    expect(response.status).toBe(200);
    expect(authorization.teacherOwnsClass).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("reset_student_trusted_device", {
      p_subject_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      p_actor_user_id: authorization.user.id,
    });
  });

  it("allows the owning teacher to reset a student enrolled in the class", async () => {
    authorization.authenticated = true;
    authorization.ownsClass = true;
    const response = await resetTrustedDevice(request({ email, classId, enrollmentId }));

    expect(response.status).toBe(200);
    expect(authorization.teacherOwnsClass).toHaveBeenCalledWith(classId, authorization.user.id);
    expect(database.filters).toEqual(expect.arrayContaining([
      ["class_enrollments", "id", enrollmentId],
      ["class_enrollments", "class_id", classId],
      ["class_enrollments", "student_email", email],
    ]));
    expect(admin.rpc).toHaveBeenCalledOnce();
  });

  it("forbids a different teacher before reading the enrollment", async () => {
    authorization.authenticated = true;
    const response = await resetTrustedDevice(request({ email, classId, enrollmentId }));

    expect(response.status).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a student that does not belong to the owned class", async () => {
    authorization.authenticated = true;
    authorization.ownsClass = true;
    database.enrollment = null;
    const response = await resetTrustedDevice(request({ email, classId, enrollmentId }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "STUDENT_NOT_IN_CLASS" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid institutional email and incomplete class context", async () => {
    authorization.authenticated = true;
    expect((await resetTrustedDevice(request({ email: "student@gmail.com" }))).status).toBe(400);
    expect((await resetTrustedDevice(request({ email, classId }))).status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

describe("shared reset client", () => {
  it("uses the existing endpoint for manual and class-row entry points", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await resetStudentAccount(email);
    await resetStudentAccount(email, { classId, enrollmentId });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/teacher/student-device/reset", expect.objectContaining({
      body: JSON.stringify({ email }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/teacher/student-device/reset", expect.objectContaining({
      body: JSON.stringify({ email, classId, enrollmentId }),
    }));
  });

  it("returns only a friendly API error to the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "No se pudo restablecer la cuenta del estudiante." },
      { status: 500 },
    )));

    await expect(resetStudentAccount(email)).rejects.toThrow("No se pudo restablecer la cuenta del estudiante.");
  });
});

describe("student roster reset UX", () => {
  it("shows one responsive reset action for active and inactive student rows", () => {
    const component = source("components/teacher-class-detail.tsx");
    expect(component).toContain('aria-label={`Restablecer cuenta de ${student.displayName}`}');
    expect(component).toContain('>Restablecer</button><button type="button"');
    expect(component).toContain('student.status === "active" ? "Activo" : "Inactivo"');
    expect(component).toContain('student.status === "active" ? "Desactivar" : "Activar"');
    expect(component).toContain("flex max-w-full flex-wrap items-center justify-end gap-2");
  });

  it("uses the institutional dialog with identity, safe semantics and pending protection", () => {
    const component = source("components/teacher-class-detail.tsx");
    expect(component).toContain("Restablecer cuenta del estudiante");
    expect(component).toContain("Se restablecerá el dispositivo de confianza asociado a esta cuenta.");
    expect(component).toContain("Su cuenta, matrícula y asistencias no se eliminarán.");
    expect(component).toContain("RESTABLECER CUENTA");
    expect(component).toContain("Restableciendo cuenta…");
    expect(component).toContain("if (!dialog || dialogBusy) return");
    expect(component).toContain("Cuenta restablecida. El estudiante podrá vincular nuevamente su navegador al iniciar sesión.");
  });

  it("keeps reset independent from enrollment state and preserves the manual form", () => {
    const classDetail = source("components/teacher-class-detail.tsx");
    const resetBranch = classDetail.slice(
      classDetail.indexOf("await resetStudentAccount(dialog.student.email"),
      classDetail.indexOf("setDialog(null)", classDetail.indexOf("await resetStudentAccount(dialog.student.email")),
    );
    expect(resetBranch).not.toContain("setStudents");

    const dashboard = source("components/teacher-dashboard.tsx");
    expect(dashboard).toContain("Restablecer dispositivo de estudiante");
    expect(dashboard).toContain("await resetStudentAccount(email)");
  });
});

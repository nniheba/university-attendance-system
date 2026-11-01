import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("v0.6.3 flexible enrollment policy", () => {
  it("adds immutable class and per-session policy fields in one new migration", () => {
    const sql = source("supabase/migrations/20260924125244_navigation_flexible_enrollment.sql");
    expect(sql).toContain("enrollment_mode text not null default 'closed'");
    expect(sql).toContain("check (enrollment_mode in ('closed', 'self_enroll'))");
    expect(sql).toContain("allow_self_enrollment boolean not null default false");
    expect(sql).toContain("self_enroll_student_for_session");
    expect(sql).toContain("current_session.opened_at");
    expect(sql).toContain("message = 'ENROLLMENT_INACTIVE'");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("from public, anon, authenticated");
  });

  it("requires an exact class policy and a strict session boolean in server APIs", () => {
    const classes = source("app/api/classes/route.ts");
    const sessions = source("app/api/sessions/route.ts");
    expect(classes).toContain('enrollmentMode !== "closed" && enrollmentMode !== "self_enroll"');
    expect(classes).toContain("enrollment_mode: enrollmentMode");
    expect(sessions).toContain('typeof body.allowSelfEnrollment !== "boolean"');
    expect(sessions).toContain("allow_self_enrollment: body.allowSelfEnrollment");
  });

  it("makes class and session choices explicit in the teacher UI", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    expect(dashboard).toContain("¿Cómo se matricularán los estudiantes?");
    expect(dashboard).toContain("Lista cerrada");
    expect(dashboard).toContain("Matrícula abierta");
    expect(dashboard).toContain("¿Permitir que estudiantes nuevos se matriculen durante esta sesión?");
    expect(dashboard).toContain('course.enrollment_mode === "self_enroll"');
    expect(source("components/teacher-class-detail.tsx")).toContain("Detalles y política de matrícula");
  });

  it("keeps self-enrollment behind the dynamic scan flow and manual attendance unchanged", () => {
    const scan = source("app/api/attendance/scan/route.ts");
    const manual = source("app/api/sessions/[id]/attendance/manual/route.ts");
    expect(scan.indexOf("verifyAttendanceQrToken")).toBeLessThan(scan.indexOf("self_enroll_student_for_session"));
    expect(scan).toContain("ensureTrustedStudentDevice");
    expect(scan).toContain("ENROLLMENT_INACTIVE");
    expect(manual).not.toContain("self_enroll_student_for_session");
    expect(source("app/api/classes/route.ts")).not.toContain("self_enroll_student_for_session");
    expect(source("app/api/classes/[classId]/students/route.ts")).not.toContain("self_enroll_student_for_session");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("v0.5.1 fast student UI flow", () => {
  it("does not carry a scanned QR through first-time login", () => {
    const attendancePage = source("app/attendance/[token]/page.tsx");
    const loginPage = source("app/login/page.tsx");
    const scanPage = source("app/student/scan/page.tsx");
    expect(attendancePage).toContain("redirect(attendanceLoginUrl())");
    expect(attendancePage).not.toContain("next=/attendance");
    expect(loginPage).toContain("safeAttendanceIntent(query.next)");
    expect(scanPage).toContain('attendanceIntent={intent === "attendance"}');
  });

  it("registers directly without a name form or geolocation step", () => {
    const attendance = source("components/student-attendance.tsx");
    expect(attendance).toContain("submitAttendanceToken(qrToken)");
    expect(attendance).toContain('window.history.replaceState({}, "", "/student")');
    expect(attendance).not.toContain("navigator.geolocation");
    expect(attendance).not.toContain("VERIFICAR MI UBICACIÓN");
    expect(attendance).not.toContain("REGISTRAR ASISTENCIA");
    expect(attendance).not.toContain("Nombre y apellidos completos");
  });

  it("provides focused student landing and profile routes", () => {
    const dashboard = source("components/student-dashboard.tsx");
    const profile = source("components/student-profile-form.tsx");
    expect(dashboard).toContain("Escanear asistencia");
    expect(dashboard).toContain('href="/student/scan"');
    expect(dashboard).toContain("Estudiante");
    expect(dashboard).toContain("Mis asignaturas");
    expect(profile).toContain("Correo institucional");
    expect(profile).toContain("readOnly");
  });
});

import { describe, expect, it } from "vitest";
import { sessionAttendanceCsv, sessionCsvFilename } from "@/lib/academic/session-csv";

describe("academic session CSV", () => {
  it("exports session context, student identity and separate Madrid times safely", () => {
    const context = {
      sessionName: "-Docker y contenedores",
      openedAt: "2026-09-24T16:34:00.000Z",
      course: {
        name: "=Informática",
        groupName: "+IYA2021",
        academicYear: "@2026-2027",
      },
    };
    const csv = sessionAttendanceCsv(context, [{
      full_name: "=Mario Camilo",
      student_email_snapshot: "+mario.camilo@students.example.edu",
      registered_at: "2026-09-24T16:36:00.000Z",
      source: "qr",
      review_status: "normal",
      gps_status: "verified",
    }]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1).split("\r\n")[0]).toBe("\"Nombre completo\",\"Correo institucional\",\"Asignatura\",\"Grupo\",\"Periodo académico\",\"Sesión\",\"Fecha de sesión\",\"Hora de sesión\",\"Hora de registro\",\"Origen\",\"Estado\",\"Ubicación\"");
    for (const protectedValue of [
      "'=Mario Camilo",
      "'+mario.camilo@students.example.edu",
      "'=Informática",
      "'+IYA2021",
      "'@2026-2027",
      "'-Docker y contenedores",
    ]) expect(csv).toContain(`\"${protectedValue}\"`);
    expect(csv).toContain("\"24 sept 2026\",\"18:34\",\"18:36\"");
    expect(csv).toContain("\"QR\",\"Normal\",\"Compatible\"");
    expect(sessionCsvFilename(context)).toBe("informatica-docker-y-contenedores-2026-09-24.csv");
  });

  it("uses stable fallbacks for historical and nullable context", () => {
    const csv = sessionAttendanceCsv({
      sessionName: null,
      openedAt: "2026-09-24T16:34:00.000Z",
      course: { name: "Informática", groupName: null, academicYear: null },
    }, []);
    expect(csv).toContain("\"Sesión\"");
    expect(csv).not.toContain("null");
    expect(csv).not.toContain("undefined");
  });
});

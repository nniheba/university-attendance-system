import { describe, expect, it } from "vitest";
import { attendanceMatrixCsv, effectiveStatusCsvLabel, matrixCsvFilename } from "@/lib/academic/matrix-csv";
import { buildAttendanceMatrix } from "@/lib/academic/attendance-matrix";
import type { AttendanceMatrixData } from "@/lib/types";

describe("class attendance matrix CSV", () => {
  it("uses effective states, Madrid headers, BOM, CRLF and spreadsheet protection", () => {
    const matrix = {
      class: { id: "class-a", name: "=Programming", group_name: "+IYA2021", academic_year: "@2026-2027", status: "active", color_key: "blue" },
      sessions: [{ id: "session-a", name: "-Docker", colorKey: "cyan", openedAt: "2026-09-10T07:00:00Z", closedAt: "2026-09-10T08:00:00Z", enableProjectionBubbles: true, summary: { present: 1, absent: 0, suspicious: 0, eligibleSessions: 1, percentage: 100 } }],
      rows: [{
        enrollmentId: "enrollment-a",
        studentEmail: "+formula@students.example.edu",
        displayName: "=2+2",
        enrollmentStatus: "active",
        attendance: { present: 1, absent: 0, suspicious: 0, eligibleSessions: 1, percentage: 100 },
        cells: [{ sessionId: "session-a", enrollmentId: "enrollment-a", effectiveStatus: "present", rawStatus: "present", origin: "qr", registeredAt: "2026-09-10T07:01:00Z", gpsStatus: "verified", reviewStatus: "normal", override: null, audit: [] }],
      }],
    } satisfies AttendanceMatrixData;
    const csv = attendanceMatrixCsv(matrix);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'-Docker · 10 SEPT 09:00");
    expect(csv).toContain("\"'=Programming\"");
    expect(csv).toContain("\"'+IYA2021\"");
    expect(csv).toContain("\"'@2026-2027\"");
    expect(csv).toContain("\"'=2+2\"");
    expect(csv).toContain("\"'+formula@students.example.edu\"");
    expect(csv).toContain("\"Presente\"");
    expect(csv).toContain("\"100.00%\"");
    expect(csv).toContain("\r\n");
    expect(matrixCsvFilename(matrix.class)).toBe("programming-iya2021-2026-2027-matriz-asistencia.csv");
  });

  it("exports a missing eligible record exactly as No registró", () => {
    expect(effectiveStatusCsvLabel("not_registered")).toBe("No registró");
    expect(effectiveStatusCsvLabel("not_applicable")).toBe("No aplica");
  });

  it("keeps inactive roster rows but never exports soft-removed session columns", () => {
    const matrix = buildAttendanceMatrix({
      course: { id: "class-a", name: "Programación", group_name: null, academic_year: null, status: "active", color_key: "blue" },
      enrollments: [
        { id: "visible", class_id: "class-a", student_email: "visible@students.example.edu", student_user_id: null, status: "active" },
        { id: "inactive", class_id: "class-a", student_email: "inactive@students.example.edu", student_user_id: null, status: "inactive" },
      ],
      sessions: [
        { id: "visible-session", class_id: "class-a", session_name: "Visible", color_key: "blue", opened_at: "2026-09-01T09:00:00Z", closed_at: "2026-09-01T10:00:00Z", status: "closed", counts_toward_attendance: true, enable_projection_bubbles: true, deleted_at: null, attendance: [] },
        { id: "removed-session", class_id: "class-a", session_name: "Removed session", color_key: "blue", opened_at: "2026-09-02T09:00:00Z", closed_at: "2026-09-02T10:00:00Z", status: "closed", counts_toward_attendance: true, enable_projection_bubbles: true, deleted_at: "2026-09-29T10:00:00Z", attendance: [] },
      ],
      overrides: [],
      audit: [],
    });
    const csv = attendanceMatrixCsv(matrix);
    expect(csv).toContain("visible@students.example.edu");
    expect(csv).toContain("inactive@students.example.edu");
    expect(csv).toContain("Visible");
    expect(csv).not.toContain("Removed session");
  });
});

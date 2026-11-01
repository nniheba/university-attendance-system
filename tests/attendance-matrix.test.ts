import { describe, expect, it } from "vitest";
import { buildAttendanceMatrix } from "@/lib/academic/attendance-matrix";
import { deriveEffectiveAttendanceStatus, deriveEnrollmentAttendance } from "@/lib/academic/attendance-statistics";

const course = { id: "class-a", name: "Programación", group_name: "A", academic_year: "2026", status: "active" as const, color_key: "purple" as const };
type MatrixSessionInput = Parameters<typeof buildAttendanceMatrix>[0]["sessions"][number];
const sessions: MatrixSessionInput[] = ["01", "02", "03", "04"].map((day) => ({
  id: `session-${day}`,
  class_id: "class-a",
  session_name: `Sesión ${day}`,
  color_key: "blue" as const,
  opened_at: `2026-09-${day}T09:00:00Z`,
  closed_at: `2026-09-${day}T10:00:00Z`,
  status: "closed" as const,
  counts_toward_attendance: true as const,
  enable_projection_bubbles: true,
  attendance: [],
}));

describe("effective attendance and teacher matrix", () => {
  it("applies eligibility, override and raw evidence in strict priority order", () => {
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: { reviewStatus: "normal", voidedAt: null } })).toBe("present");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: { reviewStatus: "suspicious", voidedAt: null } })).toBe("suspicious");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: null })).toBe("not_registered");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: { reviewStatus: "normal", voidedAt: null }, overrideStatus: "absent" })).toBe("absent");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: null, overrideStatus: "present" })).toBe("present");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: { reviewStatus: "normal", voidedAt: null }, overrideStatus: "suspicious" })).toBe("suspicious");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: { reviewStatus: "normal", voidedAt: "2026-09-01T10:00:00Z" } })).toBe("absent");
    expect(deriveEffectiveAttendanceStatus({ eligible: true, attendance: { reviewStatus: "normal", voidedAt: "2026-09-01T10:00:00Z" }, overrideStatus: "present" })).toBe("present");
    expect(deriveEffectiveAttendanceStatus({ eligible: false, attendance: { reviewStatus: "normal", voidedAt: null }, overrideStatus: "present" })).toBe("not_applicable");
  });

  it("derives missing eligible records as no registration and lowers the percentage", () => {
    sessions[0].attendance = [{ id: "a1", session_id: "session-01", student_user_id: "student-a", student_email_snapshot: "a@students.example.edu", registered_at: "2026-09-01T09:02:00Z", source: "qr", review_status: "normal", gps_status: "verified", voided_at: null }];
    sessions[2].attendance = [{ id: "a3", session_id: "session-03", student_user_id: "student-a", student_email_snapshot: "a@students.example.edu", registered_at: "2026-09-03T09:02:00Z", source: "manual", review_status: "suspicious", gps_status: "not_shared", voided_at: null }];
    const matrix = buildAttendanceMatrix({
      course,
      enrollments: [{
        id: "enrollment-a",
        class_id: "class-a",
        student_email: "a@students.example.edu",
        student_user_id: "student-a",
        status: "active",
      }],
      sessions,
      overrides: [],
      audit: [],
      studentNames: new Map([["student-a", "Alumno A"]]),
    });
    expect(matrix.rows[0].cells.map((cell) => cell.effectiveStatus)).toEqual(["present", "not_registered", "suspicious", "not_registered"]);
    expect(matrix.rows[0].attendance).toEqual({ present: 2, absent: 2, suspicious: 1, eligibleSessions: 4, percentage: 50 });
    expect(matrix.sessions[3].summary.eligibleSessions).toBe(1);
    expect(matrix.sessions[0]).toMatchObject({ name: "Sesión 01", colorKey: "blue" });
  });

  it("uses the same override in the student history and teacher matrix", () => {
    const student = deriveEnrollmentAttendance([
      { id: "session-01", classId: "class-a", name: "Introducción", colorKey: "blue", openedAt: "2026-09-01T09:00:00Z", closedAt: "2026-09-01T10:00:00Z", status: "closed", countsTowardAttendance: true },
    ], [{ id: "a1", sessionId: "session-01", registeredAt: "2026-09-01T09:02:00Z", source: "qr", reviewStatus: "normal", voidedAt: null }], [{ sessionId: "session-01", status: "absent" }]);
    expect(student.history[0].status).toBe("absent");
    expect(student.attendance.percentage).toBe(0);
  });

  it("keeps inactive enrollments as roster rows while excluding removed sessions", () => {
    const visibleSession = { ...sessions[0], id: "visible-session", attendance: [] };
    const removedSession = { ...sessions[1], id: "removed-session", deleted_at: "2026-09-29T10:00:00Z", attendance: [] };
    const matrix = buildAttendanceMatrix({
      course,
      enrollments: [
        { id: "visible", class_id: "class-a", student_email: "visible@students.example.edu", student_user_id: "visible", status: "active" },
        { id: "inactive", class_id: "class-a", student_email: "inactive@students.example.edu", student_user_id: "inactive", status: "inactive" },
      ],
      sessions: [visibleSession, removedSession],
      overrides: [],
      audit: [],
    });

    expect(matrix.rows.map((row) => row.enrollmentId)).toEqual(["inactive", "visible"]);
    expect(matrix.sessions.map((session) => session.id)).toEqual(["visible-session"]);
    expect(matrix.rows.find((row) => row.enrollmentId === "visible")?.attendance).toMatchObject({ eligibleSessions: 1, absent: 1, percentage: 0 });
    expect(matrix.rows.find((row) => row.enrollmentId === "inactive")?.enrollmentStatus).toBe("inactive");
  });

  it("recalculates four of ten to four of nine after removing one missed session", () => {
    const tenSessions: MatrixSessionInput[] = Array.from({ length: 10 }, (_, index) => {
      const id = `percentage-${index + 1}`;
      return {
        ...sessions[0],
        id,
        opened_at: `2026-09-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
        closed_at: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
        deleted_at: index === 9 ? "2026-09-29T10:00:00Z" : null,
        attendance: index < 4 ? [{
          id: `attendance-${index}`,
          session_id: id,
          student_user_id: "student-percentage",
          student_email_snapshot: "percentage@students.example.edu",
          registered_at: `2026-09-${String(index + 1).padStart(2, "0")}T09:02:00Z`,
          source: "qr",
          review_status: "normal",
          gps_status: "not_shared",
          voided_at: null,
        }] : [],
      };
    });
    const enrollment = [{
      id: "enrollment-percentage",
      class_id: "class-a",
      student_email: "percentage@students.example.edu",
      student_user_id: "student-percentage",
      status: "active" as const,
    }];

    const before = buildAttendanceMatrix({ course, enrollments: enrollment, sessions: tenSessions.map((session) => ({ ...session, deleted_at: null })), overrides: [], audit: [] });
    const after = buildAttendanceMatrix({ course, enrollments: enrollment, sessions: tenSessions, overrides: [], audit: [] });
    expect(before.rows[0].attendance).toMatchObject({ present: 4, eligibleSessions: 10, percentage: 40 });
    expect(after.rows[0].attendance).toMatchObject({ present: 4, eligibleSessions: 9, percentage: 44.44 });
  });

  it("reorders columns and preserves overrides after a session edit", () => {
    const enrollment = {
      id: "enrollment-edit",
      class_id: "class-a",
      student_email: "edit@students.example.edu",
      student_user_id: "student-edit",
      status: "active" as const,
    };
    const laterSession: MatrixSessionInput = {
      ...sessions[0],
      id: "session-edit",
      session_name: "Antes de editar",
      opened_at: "2026-09-24T19:00:00Z",
      closed_at: "2026-09-24T20:00:00Z",
    };
    const middleSession: MatrixSessionInput = {
      ...sessions[1],
      id: "session-middle",
      opened_at: "2026-09-24T18:30:00Z",
      closed_at: "2026-09-24T19:30:00Z",
    };
    const override = {
      id: "override-edit",
      class_id: "class-a",
      session_id: "session-edit",
      enrollment_id: enrollment.id,
      status: "present" as const,
      reason: "Corrección existente",
      updated_at: "2026-09-24T20:10:00Z",
    };

    const before = buildAttendanceMatrix({ course, enrollments: [enrollment], sessions: [laterSession, middleSession], overrides: [override], audit: [] });
    expect(before.sessions.map((session) => session.id)).toEqual(["session-middle", "session-edit"]);
    expect(before.rows[0].cells[1]).toMatchObject({ effectiveStatus: "present", override: { id: "override-edit" } });

    const editedSession = { ...laterSession, session_name: "Horario corregido", color_key: "green" as const, opened_at: "2026-09-24T16:30:00Z" };
    const after = buildAttendanceMatrix({ course, enrollments: [enrollment], sessions: [editedSession, middleSession], overrides: [override], audit: [] });
    expect(after.sessions.map((session) => session.id)).toEqual(["session-edit", "session-middle"]);
    expect(after.sessions[0]).toMatchObject({ name: "Horario corregido", colorKey: "green" });
    expect(after.rows[0].cells[0]).toMatchObject({ effectiveStatus: "present", override: { id: "override-edit" } });

    const studentBefore = deriveEnrollmentAttendance([
      { id: "session-edit", classId: "class-a", name: "Antes de editar", colorKey: "blue", openedAt: laterSession.opened_at, closedAt: laterSession.closed_at, status: "closed", countsTowardAttendance: true },
    ], [], [{ sessionId: "session-edit", status: "present" }]);
    expect(studentBefore.history[0]).toMatchObject({ name: "Antes de editar", status: "present" });

    const studentAfter = deriveEnrollmentAttendance([
      { id: "session-edit", classId: "class-a", name: "Horario corregido", colorKey: "green", openedAt: editedSession.opened_at, closedAt: editedSession.closed_at, status: "closed", countsTowardAttendance: true },
    ], [], [{ sessionId: "session-edit", status: "present" }]);
    expect(studentAfter.history[0]).toMatchObject({ name: "Horario corregido", status: "present" });
    expect(studentAfter.attendance.eligibleSessions).toBe(1);
  });

  it("shows a five-session late enrollment as four no-registration cells and 20 percent", () => {
    const fiveSessions = ["01", "02", "03", "04", "05"].map((day) => ({
      ...sessions[0],
      id: `late-${day}`,
      opened_at: `2026-09-${day}T09:00:00Z`,
      closed_at: `2026-09-${day}T10:00:00Z`,
      attendance: day === "05" ? [{
        id: "late-attendance",
        session_id: "late-05",
        student_user_id: "student-late",
        student_email_snapshot: "late@students.example.edu",
        registered_at: "2026-09-05T09:04:00Z",
        source: "qr" as const,
        review_status: "normal" as const,
        gps_status: "verified" as const,
        voided_at: null,
      }] : [],
    }));
    const matrix = buildAttendanceMatrix({
      course,
      enrollments: [{
        id: "enrollment-late",
        class_id: "class-a",
        student_email: "late@students.example.edu",
        student_user_id: "student-late",
        status: "active",
      }],
      sessions: fiveSessions,
      overrides: [],
      audit: [],
    });

    expect(matrix.rows[0].cells.map((cell) => cell.effectiveStatus)).toEqual([
      "not_registered", "not_registered", "not_registered", "not_registered", "present",
    ]);
    expect(matrix.rows[0].attendance).toEqual({ present: 1, absent: 4, suspicious: 0, eligibleSessions: 5, percentage: 20 });

    const corrected = buildAttendanceMatrix({
      course,
      enrollments: [{
        id: "enrollment-late",
        class_id: "class-a",
        student_email: "late@students.example.edu",
        student_user_id: "student-late",
        status: "active",
      }],
      sessions: fiveSessions,
      overrides: [{
        id: "override-late-01",
        class_id: "class-a",
        session_id: "late-01",
        enrollment_id: "enrollment-late",
        status: "present",
        reason: "Justificante docente",
        updated_at: "2026-09-06T10:00:00Z",
      }],
      audit: [{
        id: "audit-late-01",
        session_id: "late-01",
        enrollment_id: "enrollment-late",
        actor_user_id: "teacher-a",
        previous_status: null,
        new_status: "present",
        reason: "Justificante docente",
        action: "set_override",
        created_at: "2026-09-06T10:00:00Z",
      }],
      actorNames: new Map([["teacher-a", "Docente A"]]),
    });
    expect(corrected.rows[0].cells[0]).toMatchObject({
      effectiveStatus: "present",
      audit: [{ action: "set_override", newStatus: "present", actorName: "Docente A" }],
    });
    expect(corrected.rows[0].attendance).toMatchObject({ present: 2, absent: 3, eligibleSessions: 5, percentage: 40 });
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateStudentAcademicSummary,
  deriveAttendanceStatus,
  deriveEnrollmentAttendance,
  formatAttendancePercentage,
  type AcademicSessionForStatistics,
  type AttendanceForStatistics,
} from "@/lib/academic/attendance-statistics";
import type { StudentClassSummary } from "@/lib/types";

const closedSession = (
  id: string,
  openedAt: string,
  overrides: Partial<AcademicSessionForStatistics> = {},
): AcademicSessionForStatistics => ({
  id,
  classId: "class-a",
  name: "Sesión",
  colorKey: "blue",
  openedAt,
  closedAt: new Date(new Date(openedAt).getTime() + 3_600_000).toISOString(),
  status: "closed",
  countsTowardAttendance: true,
  ...overrides,
});

const attendance = (
  id: string,
  sessionId: string,
  overrides: Partial<AttendanceForStatistics> = {},
): AttendanceForStatistics => ({
  id,
  sessionId,
  registeredAt: "2026-09-02T09:03:00Z",
  source: "qr",
  reviewStatus: "normal",
  voidedAt: null,
  ...overrides,
});

describe("shared academic attendance statistics", () => {
  it("derives present, suspicious and absent without exposing moderation details", () => {
    expect(deriveAttendanceStatus({ reviewStatus: "normal", voidedAt: null })).toBe("present");
    expect(deriveAttendanceStatus({ reviewStatus: "suspicious", voidedAt: null })).toBe("suspicious");
    expect(deriveAttendanceStatus({ reviewStatus: "normal", voidedAt: "2026-09-03T10:00:00Z" })).toBe("absent");
    expect(deriveAttendanceStatus(null)).toBe("absent");
  });

  it("uses every closed computable class session for numerator and denominator", () => {
    const sessions = [
      closedSession("qr", "2026-09-02T09:00:00Z"),
      closedSession("manual", "2026-09-03T09:00:00Z"),
      closedSession("suspicious", "2026-09-04T09:00:00Z"),
      closedSession("voided", "2026-09-05T09:00:00Z"),
      closedSession("absent", "2026-09-06T09:00:00Z"),
      closedSession("open", "2026-09-07T09:00:00Z", { status: "open", closedAt: null }),
      closedSession("non-computable", "2026-09-08T09:00:00Z", { countsTowardAttendance: false }),
      closedSession("before", "2026-08-30T09:00:00Z"),
      closedSession("gap", "2026-09-15T09:00:00Z"),
      closedSession("reactivated", "2026-09-21T09:00:00Z"),
    ];
    const records = [
      attendance("a-qr", "qr"),
      attendance("a-manual", "manual", { source: "manual" }),
      attendance("a-suspicious", "suspicious", { reviewStatus: "suspicious" }),
      attendance("a-voided", "voided", { voidedAt: "2026-09-05T10:00:00Z" }),
      attendance("a-reactivated", "reactivated"),
    ];
    const result = deriveEnrollmentAttendance(sessions, records);

    expect(result.attendance).toEqual({
      present: 4,
      absent: 4,
      suspicious: 1,
      eligibleSessions: 8,
      percentage: 50,
    });
    expect(result.history.map((row) => row.sessionId)).toEqual([
      "reactivated", "gap", "absent", "voided", "suspicious", "manual", "qr", "before",
    ]);
    expect(result.history.find((row) => row.sessionId === "manual")).toMatchObject({ status: "present", origin: "manual" });
    expect(result.history.find((row) => row.sessionId === "manual")).toMatchObject({ name: "Sesión", colorKey: "blue" });
    expect(result.history.find((row) => row.sessionId === "suspicious")).toMatchObject({ status: "suspicious", origin: "qr" });
    expect(result.history.find((row) => row.sessionId === "voided")).toMatchObject({ status: "absent", origin: null });
    expect(result.history.some((row) => ["open", "non-computable"].includes(row.sessionId))).toBe(false);
  });

  it("calculates the global percentage from weighted opportunities", () => {
    const course = (id: string, present: number, eligibleSessions: number): StudentClassSummary => ({
      id,
      name: id,
      groupName: null,
      academicYear: null,
      teacherName: "Docente",
      colorKey: "blue",
      status: "active",
      enrollmentStatus: "active",
      attendance: {
        present,
        absent: eligibleSessions - present,
        suspicious: 0,
        eligibleSessions,
        percentage: present / eligibleSessions * 100,
      },
    });
    const summary = aggregateStudentAcademicSummary([course("A", 2, 2), course("B", 1, 8)]);
    expect(summary.overall).toEqual({ present: 3, eligibleSessions: 10, percentage: 30, classCount: 2 });
    expect(summary.overall.percentage).not.toBe(56.25);
  });

  it("does not grant a late-enrolled student a free 100 percent", () => {
    const sessions = [
      closedSession("a", "2026-09-01T09:00:00Z"),
      closedSession("b", "2026-09-08T09:00:00Z"),
      closedSession("c", "2026-09-15T09:00:00Z"),
      closedSession("d", "2026-09-22T09:00:00Z"),
    ];
    const result = deriveEnrollmentAttendance(
      sessions,
      [attendance("joining-attendance", "c", { registeredAt: "2026-09-15T09:04:00Z" })],
    );
    expect(result.history.map((row) => [row.sessionId, row.status])).toEqual([
      ["d", "absent"],
      ["c", "present"],
      ["b", "absent"],
      ["a", "absent"],
    ]);
    expect(result.attendance).toEqual({ present: 1, absent: 3, suspicious: 0, eligibleSessions: 4, percentage: 25 });
  });

  it("counts four missing registrations and one attendance as 20 percent", () => {
    const sessions = ["01", "02", "03", "04", "05"].map((day) => (
      closedSession(`session-${day}`, `2026-09-${day}T09:00:00Z`)
    ));
    const result = deriveEnrollmentAttendance(
      sessions,
      [attendance("only-attendance", "session-05")],
    );

    expect(result.history.map((row) => row.status)).toEqual(["present", "absent", "absent", "absent", "absent"]);
    expect(result.attendance).toEqual({ present: 1, absent: 4, suspicious: 0, eligibleSessions: 5, percentage: 20 });
  });

  it("formats no-data and percentages with at most two decimals", () => {
    expect(formatAttendancePercentage(null)).toBe("—%");
    expect(formatAttendancePercentage(75)).toBe("75%");
    expect(formatAttendancePercentage(85.714)).toBe("85,71%");
  });
});

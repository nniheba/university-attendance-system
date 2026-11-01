import { describe, expect, it } from "vitest";
import { attendancePercentage, sessionEligibleForEnrollment } from "@/lib/academic/statistics";

describe("academic attendance statistics foundation", () => {
  const periods = [
    { startedAt: "2026-09-10T10:00:00Z", endedAt: "2026-09-15T10:00:00Z" },
    { startedAt: "2026-09-20T10:00:00Z", endedAt: null },
  ];

  it("counts closed computable sessions inside any historical enrollment period", () => {
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-10T10:00:00Z", closedAt: "2026-09-10T11:00:00Z", countsTowardAttendance: true }, periods)).toBe(true);
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-21T10:00:00Z", closedAt: "2026-09-21T11:00:00Z", countsTowardAttendance: true }, periods)).toBe(true);
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-09T10:00:00Z", closedAt: "2026-09-09T11:00:00Z", countsTowardAttendance: true }, periods)).toBe(false);
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-17T10:00:00Z", closedAt: "2026-09-17T11:00:00Z", countsTowardAttendance: true }, periods)).toBe(false);
  });

  it("uses half-open boundaries and excludes open or non-computable sessions", () => {
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-15T10:00:00Z", closedAt: "2026-09-15T11:00:00Z", countsTowardAttendance: true }, periods)).toBe(false);
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-11T10:00:00Z", closedAt: null, countsTowardAttendance: true }, periods)).toBe(false);
    expect(sessionEligibleForEnrollment({ openedAt: "2026-09-11T10:00:00Z", closedAt: "2026-09-11T11:00:00Z", countsTowardAttendance: false }, periods)).toBe(false);
    expect(attendancePercentage(3, 4)).toBe(75);
    expect(attendancePercentage(0, 0)).toBeNull();
  });
});

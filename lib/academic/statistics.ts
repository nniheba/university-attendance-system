export interface AcademicSessionWindow {
  openedAt: string;
  closedAt: string | null;
  countsTowardAttendance: boolean;
}

export interface EnrollmentPeriod {
  startedAt: string;
  endedAt: string | null;
}

export function sessionEligibleForEnrollment(
  session: AcademicSessionWindow,
  periods: readonly EnrollmentPeriod[],
): boolean {
  if (!session.closedAt || !session.countsTowardAttendance) return false;
  const openedAt = new Date(session.openedAt).getTime();
  return periods.some((period) => {
    const startedAt = new Date(period.startedAt).getTime();
    const endedAt = period.endedAt ? new Date(period.endedAt).getTime() : null;
    return openedAt >= startedAt && (endedAt === null || openedAt < endedAt);
  });
}

export function attendancePercentage(validAttendanceCount: number, eligibleClosedSessionCount: number): number | null {
  if (eligibleClosedSessionCount <= 0) return null;
  return Math.round((Math.max(0, validAttendanceCount) / eligibleClosedSessionCount) * 10_000) / 100;
}

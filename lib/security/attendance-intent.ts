export const ATTENDANCE_SCAN_DESTINATION = "/student/scan?intent=attendance";

export function safeAttendanceIntent(value: string | null | undefined): string | null {
  return value === ATTENDANCE_SCAN_DESTINATION ? ATTENDANCE_SCAN_DESTINATION : null;
}

export function attendanceLoginUrl(): string {
  const search = new URLSearchParams({ next: ATTENDANCE_SCAN_DESTINATION });
  return `/login?${search.toString()}`;
}

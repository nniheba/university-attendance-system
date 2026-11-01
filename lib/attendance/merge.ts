import type { AttendanceRecord } from "@/lib/types";

export interface AttendanceMergeResult {
  attendance: AttendanceRecord[];
  changed: boolean;
  inserted: boolean;
}

export function mergeAttendanceRecord(
  current: AttendanceRecord[],
  incoming: AttendanceRecord,
): AttendanceMergeResult {
  const existing = current.findIndex((record) => record.id === incoming.id);
  if (existing !== -1 && current[existing] === incoming) {
    return { attendance: current, changed: false, inserted: false };
  }
  const next = existing === -1
    ? [...current, incoming]
    : current.map((record) => record.id === incoming.id ? incoming : record);
  const attendance = next.filter((record) => record.voided_at === null).sort((left, right) => {
    const byTime = left.registered_at.localeCompare(right.registered_at);
    return byTime || left.id.localeCompare(right.id);
  });
  return {
    attendance,
    changed: true,
    inserted: existing === -1,
  };
}

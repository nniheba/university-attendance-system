import type { AttendanceRecord } from "@/lib/types";

export const PROJECTION_BUBBLE_LIMIT = 6;
export const PROJECTION_BUBBLE_DURATION_MS = 4_600;
export const PROJECTION_BUBBLE_LANES = 3;

export type ProjectionAttendanceBubble = Pick<
  AttendanceRecord,
  "id" | "student_user_id" | "full_name"
> & {
  lane: number;
};

export function createProjectionAttendanceBubble(
  attendance: Pick<AttendanceRecord, "id" | "student_user_id" | "full_name">,
  sequence: number,
): ProjectionAttendanceBubble {
  return {
    id: attendance.id,
    student_user_id: attendance.student_user_id,
    full_name: attendance.full_name,
    lane: Math.abs(sequence) % PROJECTION_BUBBLE_LANES,
  };
}

export function enqueueProjectionAttendanceBubble(
  current: readonly ProjectionAttendanceBubble[],
  bubble: ProjectionAttendanceBubble,
  limit = PROJECTION_BUBBLE_LIMIT,
): ProjectionAttendanceBubble[] {
  if (current.some((item) => item.id === bubble.id)) return [...current];
  if (limit <= 0) return [];
  return [...current, bubble].slice(-limit);
}

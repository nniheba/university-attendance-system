export type AttendanceConflict = "SESSION_CLOSED" | "DEVICE_ALREADY_USED" | "DUPLICATE_ATTENDANCE" | "STUDENT_NOT_ENROLLED" | "ENROLLMENT_INACTIVE";

export function attendanceConflict(error: unknown): AttendanceConflict | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (candidate.code === "P0001") {
    if (message === "SESSION_CLOSED" || message === "DEVICE_ALREADY_USED" || message === "DUPLICATE_ATTENDANCE" || message === "STUDENT_NOT_ENROLLED" || message === "ENROLLMENT_INACTIVE") return message;
  }
  if (candidate.code === "23505") {
    if (message.includes("attendance_session_device_hash_key")) return "DEVICE_ALREADY_USED";
    if (message.includes("attendance_session_student_user_key")) return "DUPLICATE_ATTENDANCE";
  }
  return null;
}

export function isDuplicateAttendanceError(error: unknown): boolean {
  return attendanceConflict(error) === "DUPLICATE_ATTENDANCE";
}

export const ATTENDANCE_CONFLICT_MESSAGES: Record<AttendanceConflict, string> = {
  SESSION_CLOSED: "La asistencia de esta clase ya fue cerrada.",
  DEVICE_ALREADY_USED: "Este dispositivo ya registró una asistencia para esta clase.",
  DUPLICATE_ATTENDANCE: "Tu asistencia ya fue registrada para esta clase.",
  STUDENT_NOT_ENROLLED: "No estás matriculado en esta asignatura.",
  ENROLLMENT_INACTIVE: "Tu matrícula está inactiva. Pide al docente que la reactive.",
};

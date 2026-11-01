import { describe, expect, it } from "vitest";
import { isDuplicateAttendanceError } from "@/lib/security/database-errors";

describe("student identification", () => {
  it("recognizes the PostgreSQL unique-constraint error", () => {
    expect(isDuplicateAttendanceError({ code: "23505", message: 'duplicate key violates constraint "attendance_session_student_user_key"' })).toBe(true);
    expect(isDuplicateAttendanceError({ code: "23505", message: 'attendance_session_device_hash_key' })).toBe(false);
    expect(isDuplicateAttendanceError({ code: "23505" })).toBe(false);
    expect(isDuplicateAttendanceError({ code: "22000" })).toBe(false);
  });
});

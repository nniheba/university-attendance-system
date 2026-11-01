import "server-only";

import {
  aggregateAttendanceOpportunities,
  deriveEnrollmentAttendance,
  type AcademicSessionForStatistics,
  type AttendanceForStatistics,
} from "@/lib/academic/attendance-statistics";
import { createAdminClient } from "@/lib/supabase/server";
import type { ClassRecord, ClassSummary } from "@/lib/types";

interface RawTeacherEnrollment {
  id: string;
  class_id: string;
  student_email: string;
  student_user_id: string | null;
  status: "active" | "inactive";
}

interface RawTeacherAttendance {
  id: string;
  session_id: string;
  student_user_id: string | null;
  student_email_snapshot: string | null;
  registered_at: string;
  source: "qr" | "manual";
  review_status: "normal" | "suspicious";
  voided_at: string | null;
}

interface RawTeacherSession {
  id: string;
  class_id: string;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
  counts_toward_attendance: boolean;
  attendance: RawTeacherAttendance[];
}

interface RawTeacherOverride {
  class_id: string;
  session_id: string;
  enrollment_id: string;
  status: "present" | "absent" | "suspicious";
}

function sessionForStatistics(row: RawTeacherSession): AcademicSessionForStatistics {
  return {
    id: row.id,
    classId: row.class_id,
    name: "Sesión",
    colorKey: "blue",
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    status: row.status,
    countsTowardAttendance: row.counts_toward_attendance,
  };
}

function attendanceForEnrollment(
  sessions: readonly RawTeacherSession[],
  enrollment: RawTeacherEnrollment,
): AttendanceForStatistics[] {
  const result: AttendanceForStatistics[] = [];
  for (const session of sessions) {
    for (const record of session.attendance ?? []) {
      const belongsToStudent = enrollment.student_user_id
        ? record.student_user_id === enrollment.student_user_id
          || (record.student_user_id === null && record.student_email_snapshot === enrollment.student_email)
        : record.student_user_id === null && record.student_email_snapshot === enrollment.student_email;
      if (!belongsToStudent) continue;
      result.push({
        id: record.id,
        sessionId: record.session_id,
        registeredAt: record.registered_at,
        source: record.source,
        reviewStatus: record.review_status,
        voidedAt: record.voided_at,
      });
    }
  }
  return result;
}

export async function getTeacherClassSummaries(classes: readonly ClassRecord[]): Promise<ClassSummary[]> {
  if (classes.length === 0) return [];
  const classIds = classes.map((course) => course.id);
  const admin = createAdminClient();
  const [
    { data: enrollmentRows, error: enrollmentError },
    { data: sessionRows, error: sessionError },
    { data: overrideRows, error: overrideError },
  ] = await Promise.all([
    admin.from("class_enrollments")
      .select("id, class_id, student_email, student_user_id, status")
      .in("class_id", classIds),
    admin.from("sessions")
      .select(`
        id,
        class_id,
        opened_at,
        closed_at,
        status,
        counts_toward_attendance,
        attendance(
          id,
          session_id,
          student_user_id,
          student_email_snapshot,
          registered_at,
          source,
          review_status,
          voided_at
        )
      `)
      .in("class_id", classIds)
      .is("deleted_at", null),
    admin.from("attendance_overrides")
      .select("class_id, session_id, enrollment_id, status")
      .in("class_id", classIds),
  ]);
  if (enrollmentError || sessionError || overrideError) throw enrollmentError ?? sessionError ?? overrideError;
  const enrollments = (enrollmentRows ?? []) as unknown as RawTeacherEnrollment[];
  const sessions = (sessionRows ?? []) as unknown as RawTeacherSession[];
  const overrides = (overrideRows ?? []) as RawTeacherOverride[];

  return classes.map((course) => {
    const classEnrollments = enrollments.filter((row) => row.class_id === course.id);
    const classSessions = sessions.filter((row) => row.class_id === course.id);
    const statisticalSessions = classSessions.map(sessionForStatistics);
    const enrollmentStatistics = [];
    for (const enrollment of classEnrollments) {
      const result = deriveEnrollmentAttendance(
        statisticalSessions,
        attendanceForEnrollment(classSessions, enrollment),
        overrides
          .filter((row) => row.enrollment_id === enrollment.id)
          .map((row) => ({ sessionId: row.session_id, status: row.status })),
      );
      enrollmentStatistics.push(result.attendance);
    }
    const aggregate = aggregateAttendanceOpportunities(enrollmentStatistics);
    return {
      ...course,
      student_count: classEnrollments.filter((row) => row.status === "active").length,
      session_count: classSessions.length,
      closed_session_count: classSessions.filter((row) => (
        row.status === "closed" && row.closed_at !== null && row.counts_toward_attendance
      )).length,
      average_attendance_percentage: aggregate.percentage,
    };
  });
}

import "server-only";

import {
  aggregateStudentAcademicSummary,
  deriveEnrollmentAttendance,
  type AcademicSessionForStatistics,
  type AttendanceForStatistics,
  type AttendanceOverrideForStatistics,
} from "@/lib/academic/attendance-statistics";
import { linkStudentEnrollments, normalizeStudentEnrollmentEmail } from "@/lib/academic/enrollments";
import { createAdminClient } from "@/lib/supabase/server";
import type { StudentAcademicSummary, StudentClassDetail, StudentClassSummary } from "@/lib/types";
import { sessionDisplayName, type AcademicColorKey } from "@/lib/academic/colors";

interface RawClass {
  id: string;
  name: string;
  group_name: string | null;
  academic_year: string | null;
  teacher_name: string;
  color_key: AcademicColorKey;
  status: "active" | "archived";
}

interface RawEnrollment {
  id: string;
  class_id: string;
  student_email: string;
  student_user_id: string | null;
  status: "active" | "inactive";
  class: RawClass | RawClass[];
}

interface RawSession {
  id: string;
  class_id: string;
  session_name: string | null;
  color_key: AcademicColorKey;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
  counts_toward_attendance: boolean;
}

interface RawAttendance {
  id: string;
  session_id: string;
  registered_at: string;
  source: "qr" | "manual";
  review_status: "normal" | "suspicious";
  voided_at: string | null;
}

interface RawOverride {
  enrollment_id: string;
  session_id: string;
  status: "present" | "absent" | "suspicious";
}

const ENROLLMENT_SELECT = `
  id,
  class_id,
  student_email,
  student_user_id,
  status,
  class:classes!inner(id, name, group_name, academic_year, teacher_name, status, color_key)
`;

const ATTENDANCE_SELECT = "id, session_id, registered_at, source, review_status, voided_at";

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function mapSessions(rows: readonly RawSession[]): AcademicSessionForStatistics[] {
  return rows.map((row) => ({
    id: row.id,
    classId: row.class_id,
    name: sessionDisplayName(row.session_name),
    colorKey: row.color_key,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    status: row.status,
    countsTowardAttendance: row.counts_toward_attendance,
  }));
}

function mapAttendance(rows: readonly RawAttendance[]): AttendanceForStatistics[] {
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    registeredAt: row.registered_at,
    source: row.source,
    reviewStatus: row.review_status,
    voidedAt: row.voided_at,
  }));
}

async function readStudentAttendance(
  sessionIds: readonly string[],
  userId: string,
  email: string,
): Promise<AttendanceForStatistics[]> {
  if (sessionIds.length === 0) return [];
  const admin = createAdminClient();
  const [{ data: linked, error: linkedError }, { data: byEmail, error: emailError }] = await Promise.all([
    admin.from("attendance")
      .select(ATTENDANCE_SELECT)
      .in("session_id", [...sessionIds])
      .eq("student_user_id", userId),
    admin.from("attendance")
      .select(ATTENDANCE_SELECT)
      .in("session_id", [...sessionIds])
      .is("student_user_id", null)
      .eq("student_email_snapshot", email),
  ]);
  if (linkedError || emailError) throw linkedError ?? emailError;
  const unique = new Map<string, RawAttendance>();
  for (const row of [...(linked ?? []), ...(byEmail ?? [])] as RawAttendance[]) unique.set(row.id, row);
  return mapAttendance([...unique.values()]);
}

async function loadEnrollmentAcademicData(enrollments: readonly RawEnrollment[], userId: string, email: string) {
  const admin = createAdminClient();
  const classIds = enrollments.map((row) => row.class_id);
  if (classIds.length === 0) return {
    sessions: [] as AcademicSessionForStatistics[],
    attendance: [] as AttendanceForStatistics[],
    overrides: [] as RawOverride[],
  };
  const [{ data, error }, { data: overrideRows, error: overrideError }] = await Promise.all([
    admin.from("sessions")
      .select("id, class_id, session_name, color_key, opened_at, closed_at, status, counts_toward_attendance")
      .in("class_id", classIds)
      .is("deleted_at", null),
    admin.from("attendance_overrides")
      .select("enrollment_id, session_id, status")
      .in("enrollment_id", enrollments.map((row) => row.id)),
  ]);
  if (error || overrideError) throw error ?? overrideError;
  const sessions = mapSessions((data ?? []) as RawSession[]);
  const attendance = await readStudentAttendance(sessions.map((row) => row.id), userId, email);
  return { sessions, attendance, overrides: (overrideRows ?? []) as RawOverride[] };
}

function classSummary(
  enrollment: RawEnrollment,
  sessions: readonly AcademicSessionForStatistics[],
  attendance: readonly AttendanceForStatistics[],
  overrides: readonly RawOverride[],
): { summary: StudentClassSummary; history: StudentClassDetail["history"] } {
  const course = one(enrollment.class);
  const classSessions = sessions.filter((row) => row.classId === enrollment.class_id);
  const sessionIds = new Set(classSessions.map((row) => row.id));
  const result = deriveEnrollmentAttendance(
    classSessions,
    attendance.filter((row) => sessionIds.has(row.sessionId)),
    overrides
      .filter((row) => row.enrollment_id === enrollment.id && sessionIds.has(row.session_id))
      .map((row): AttendanceOverrideForStatistics => ({ sessionId: row.session_id, status: row.status })),
  );
  return {
    summary: {
      id: course.id,
      name: course.name,
      groupName: course.group_name,
      academicYear: course.academic_year,
      teacherName: course.teacher_name,
      colorKey: course.color_key,
      status: course.status,
      enrollmentStatus: enrollment.status,
      attendance: result.attendance,
    },
    history: result.history,
  };
}

export async function getStudentAcademicSummary(userId: string, emailValue: unknown): Promise<StudentAcademicSummary> {
  const email = normalizeStudentEnrollmentEmail(emailValue);
  if (!email) throw new Error("INVALID_STUDENT_EMAIL");
  await linkStudentEnrollments(userId, email);
  const { data, error } = await createAdminClient()
    .from("class_enrollments")
    .select(ENROLLMENT_SELECT)
    .eq("student_user_id", userId)
    .eq("status", "active")
    .eq("class.status", "active")
    .order("enrolled_at", { ascending: false });
  if (error) throw error;
  const enrollments = (data ?? []) as unknown as RawEnrollment[];
  const academicData = await loadEnrollmentAcademicData(enrollments, userId, email);
  return aggregateStudentAcademicSummary(enrollments.map((enrollment) => classSummary(
    enrollment,
    academicData.sessions,
    academicData.attendance,
    academicData.overrides,
  ).summary));
}

export async function getStudentClassDetail(
  userId: string,
  emailValue: unknown,
  classId: string,
): Promise<StudentClassDetail | null> {
  const email = normalizeStudentEnrollmentEmail(emailValue);
  if (!email) throw new Error("INVALID_STUDENT_EMAIL");
  await linkStudentEnrollments(userId, email);
  const { data, error } = await createAdminClient()
    .from("class_enrollments")
    .select(ENROLLMENT_SELECT)
    .eq("student_user_id", userId)
    .eq("class_id", classId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const enrollment = data as unknown as RawEnrollment;
  const academicData = await loadEnrollmentAcademicData([enrollment], userId, email);
  const result = classSummary(enrollment, academicData.sessions, academicData.attendance, academicData.overrides);
  return { ...result.summary, history: result.history };
}

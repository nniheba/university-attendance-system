import "server-only";

import {
  deriveAttendanceStatus,
  deriveEffectiveAttendanceStatus,
  effectiveAttendanceCountsAsPresent,
} from "@/lib/academic/attendance-statistics";
import { attendancePercentage } from "@/lib/academic/statistics";
import { deriveInstitutionalDisplayName } from "@/lib/security/institutional-email";
import { createAdminClient } from "@/lib/supabase/server";
import type {
  AttendanceMatrixCell,
  AttendanceMatrixData,
  AttendanceMatrixRow,
  AttendanceMatrixSession,
  StudentAttendanceStatus,
  StudentClassAttendanceStats,
} from "@/lib/types";
import { sessionDisplayName, type AcademicColorKey } from "@/lib/academic/colors";

interface MatrixClassRow {
  id: string;
  name: string;
  group_name: string | null;
  academic_year: string | null;
  status: "active" | "archived";
  color_key: AcademicColorKey;
}

interface MatrixEnrollmentRow {
  id: string;
  class_id: string;
  student_email: string;
  student_user_id: string | null;
  status: "active" | "inactive";
}

interface MatrixAttendanceRow {
  id: string;
  session_id: string;
  student_user_id: string | null;
  student_email_snapshot: string | null;
  registered_at: string;
  source: "qr" | "manual";
  review_status: "normal" | "suspicious";
  gps_status: "not_shared" | "shared" | "verified" | "outside" | "inaccurate" | "unavailable";
  voided_at: string | null;
}

interface MatrixSessionRow {
  id: string;
  class_id: string;
  session_name: string | null;
  color_key: AcademicColorKey;
  opened_at: string;
  closed_at: string;
  status: "closed";
  counts_toward_attendance: true;
  enable_projection_bubbles: boolean;
  attendance: MatrixAttendanceRow[];
  deleted_at?: string | null;
}

interface MatrixOverrideRow {
  id: string;
  class_id: string;
  session_id: string;
  enrollment_id: string;
  status: StudentAttendanceStatus;
  reason: string;
  updated_at: string;
}

interface MatrixAuditRow {
  id: string;
  session_id: string;
  enrollment_id: string;
  actor_user_id: string | null;
  previous_status: StudentAttendanceStatus | null;
  new_status: StudentAttendanceStatus | null;
  reason: string;
  action: "set_override" | "change_override" | "clear_override";
  created_at: string;
}

function cellKey(sessionId: string, enrollmentId: string): string {
  return `${sessionId}:${enrollmentId}`;
}

function identityKeys(record: MatrixAttendanceRow): string[] {
  const keys: string[] = [];
  if (record.student_user_id) keys.push(`${record.session_id}:user:${record.student_user_id}`);
  if (record.student_email_snapshot) keys.push(`${record.session_id}:email:${record.student_email_snapshot}`);
  return keys;
}

function preferableAttendance(
  current: MatrixAttendanceRow | undefined,
  candidate: MatrixAttendanceRow,
): MatrixAttendanceRow {
  if (!current) return candidate;
  const currentActive = current.voided_at === null;
  const candidateActive = candidate.voided_at === null;
  if (candidateActive !== currentActive) return candidateActive ? candidate : current;
  return candidate.registered_at > current.registered_at ? candidate : current;
}

function summarizeStatuses(statuses: readonly AttendanceMatrixCell["effectiveStatus"][]): StudentClassAttendanceStats {
  let present = 0;
  let absent = 0;
  let suspicious = 0;
  let eligibleSessions = 0;
  for (const status of statuses) {
    if (status === "not_applicable") continue;
    eligibleSessions += 1;
    if (effectiveAttendanceCountsAsPresent(status)) present += 1;
    if (status === "absent" || status === "not_registered") absent += 1;
    if (status === "suspicious") suspicious += 1;
  }
  return {
    present,
    absent,
    suspicious,
    eligibleSessions,
    percentage: attendancePercentage(present, eligibleSessions),
  };
}

export function buildAttendanceMatrix(input: {
  course: MatrixClassRow;
  enrollments: readonly MatrixEnrollmentRow[];
  sessions: readonly MatrixSessionRow[];
  overrides: readonly MatrixOverrideRow[];
  audit: readonly MatrixAuditRow[];
  studentNames?: ReadonlyMap<string, string>;
  actorNames?: ReadonlyMap<string, string>;
}): AttendanceMatrixData {
  const sessions = input.sessions
    .filter((session) => !session.deleted_at)
    .sort((left, right) => left.opened_at.localeCompare(right.opened_at));
  const attendanceByIdentity = new Map<string, MatrixAttendanceRow>();
  for (const session of sessions) {
    for (const record of session.attendance ?? []) {
      for (const key of identityKeys(record)) {
        attendanceByIdentity.set(key, preferableAttendance(attendanceByIdentity.get(key), record));
      }
    }
  }

  const overrideByCell = new Map(input.overrides.map((override) => [cellKey(override.session_id, override.enrollment_id), override]));
  const auditByCell = new Map<string, MatrixAuditRow[]>();
  for (const entry of input.audit) {
    const key = cellKey(entry.session_id, entry.enrollment_id);
    const entries = auditByCell.get(key) ?? [];
    entries.push(entry);
    auditByCell.set(key, entries);
  }
  for (const entries of auditByCell.values()) {
    entries.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  const rows: AttendanceMatrixRow[] = input.enrollments.map((enrollment) => {
    const cells = sessions.map((session): AttendanceMatrixCell => {
      const userAttendance = enrollment.student_user_id
        ? attendanceByIdentity.get(`${session.id}:user:${enrollment.student_user_id}`)
        : undefined;
      const emailAttendance = attendanceByIdentity.get(`${session.id}:email:${enrollment.student_email}`);
      const rawAttendance = userAttendance && emailAttendance
        ? preferableAttendance(userAttendance, emailAttendance)
        : userAttendance ?? emailAttendance;
      const override = overrideByCell.get(cellKey(session.id, enrollment.id));
      const rawStatus = deriveAttendanceStatus(rawAttendance ? {
        reviewStatus: rawAttendance.review_status,
        voidedAt: rawAttendance.voided_at,
      } : null);
      return {
        sessionId: session.id,
        enrollmentId: enrollment.id,
        effectiveStatus: deriveEffectiveAttendanceStatus({
          eligible: true,
          attendance: rawAttendance ? {
            reviewStatus: rawAttendance.review_status,
            voidedAt: rawAttendance.voided_at,
          } : null,
          overrideStatus: override?.status,
        }),
        rawStatus,
        origin: rawAttendance?.source ?? null,
        registeredAt: rawAttendance?.registered_at ?? null,
        gpsStatus: rawAttendance?.gps_status ?? null,
        reviewStatus: rawAttendance?.review_status ?? null,
        override: override ? {
          id: override.id,
          status: override.status,
          reason: override.reason,
          updatedAt: override.updated_at,
        } : null,
        audit: (auditByCell.get(cellKey(session.id, enrollment.id)) ?? []).map((entry) => ({
          id: entry.id,
          action: entry.action,
          previousStatus: entry.previous_status,
          newStatus: entry.new_status,
          reason: entry.reason,
          actorName: entry.actor_user_id
            ? input.actorNames?.get(entry.actor_user_id) ?? "Docente"
            : "Cuenta eliminada",
          createdAt: entry.created_at,
        })),
      };
    });
    return {
      enrollmentId: enrollment.id,
      studentEmail: enrollment.student_email,
      displayName: enrollment.student_user_id
        ? input.studentNames?.get(enrollment.student_user_id)
          ?? deriveInstitutionalDisplayName(enrollment.student_email)
          ?? enrollment.student_email
        : deriveInstitutionalDisplayName(enrollment.student_email) ?? enrollment.student_email,
      enrollmentStatus: enrollment.status,
      cells,
      attendance: summarizeStatuses(cells.map((cell) => cell.effectiveStatus)),
    };
  }).sort((left, right) => left.displayName.localeCompare(right.displayName, "es", { sensitivity: "base" }));

  const activeRows = rows.filter((row) => row.enrollmentStatus === "active");
  const matrixSessions: AttendanceMatrixSession[] = sessions.map((session, index) => ({
    id: session.id,
    name: sessionDisplayName(session.session_name),
    colorKey: session.color_key,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    enableProjectionBubbles: session.enable_projection_bubbles,
    summary: summarizeStatuses(activeRows.map((row) => row.cells[index].effectiveStatus)),
  }));

  return {
    class: input.course,
    sessions: matrixSessions,
    rows,
  };
}

export async function getTeacherAttendanceMatrix(classId: string): Promise<AttendanceMatrixData | null> {
  const admin = createAdminClient();
  const [
    { data: course, error: classError },
    { data: enrollmentRows, error: enrollmentError },
    { data: sessionRows, error: sessionError },
    { data: overrideRows, error: overrideError },
    { data: auditRows, error: auditError },
  ] = await Promise.all([
    admin.from("classes")
      .select("id, name, group_name, academic_year, status, color_key")
      .eq("id", classId)
      .maybeSingle(),
    admin.from("class_enrollments")
      .select("id, class_id, student_email, student_user_id, status")
      .eq("class_id", classId),
    admin.from("sessions")
      .select(`
        id,
        class_id,
        session_name,
        color_key,
        opened_at,
        closed_at,
        status,
        counts_toward_attendance,
        enable_projection_bubbles,
        deleted_at,
        attendance(
          id,
          session_id,
          student_user_id,
          student_email_snapshot,
          registered_at,
          source,
          review_status,
          gps_status,
          voided_at
        )
      `)
      .eq("class_id", classId)
      .eq("status", "closed")
      .eq("counts_toward_attendance", true)
      .not("closed_at", "is", null)
      .is("deleted_at", null),
    admin.from("attendance_overrides")
      .select("id, class_id, session_id, enrollment_id, status, reason, updated_at")
      .eq("class_id", classId),
    admin.from("attendance_override_audit")
      .select("id, session_id, enrollment_id, actor_user_id, previous_status, new_status, reason, action, created_at")
      .eq("class_id", classId),
  ]);
  const error = classError ?? enrollmentError ?? sessionError ?? overrideError ?? auditError;
  if (error) throw error;
  if (!course) return null;

  const enrollments = (enrollmentRows ?? []) as unknown as MatrixEnrollmentRow[];
  const audit = (auditRows ?? []) as MatrixAuditRow[];
  const studentIds = enrollments.flatMap((row) => row.student_user_id ? [row.student_user_id] : []);
  const actorIds = [...new Set(audit.flatMap((row) => row.actor_user_id ? [row.actor_user_id] : []))];
  const [studentProfiles, teacherProfiles] = await Promise.all([
    studentIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin.from("student_profiles").select("user_id, display_name").in("user_id", studentIds),
    actorIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin.from("teacher_profiles").select("user_id, display_name").in("user_id", actorIds),
  ]);
  if (studentProfiles.error || teacherProfiles.error) throw studentProfiles.error ?? teacherProfiles.error;

  return buildAttendanceMatrix({
    course: course as MatrixClassRow,
    enrollments,
    sessions: (sessionRows ?? []) as unknown as MatrixSessionRow[],
    overrides: (overrideRows ?? []) as MatrixOverrideRow[],
    audit,
    studentNames: new Map((studentProfiles.data ?? []).map((row) => [row.user_id, row.display_name])),
    actorNames: new Map((teacherProfiles.data ?? []).map((row) => [row.user_id, row.display_name])),
  });
}

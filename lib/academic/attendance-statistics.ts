import type {
  AttendanceOrigin,
  EffectiveAttendanceStatus,
  StudentAcademicSummary,
  StudentAttendanceStatus,
  StudentClassAttendanceStats,
  StudentClassSummary,
  StudentSessionAttendance,
} from "@/lib/types";
import { attendancePercentage } from "@/lib/academic/statistics";
import type { AcademicColorKey } from "@/lib/academic/colors";

export interface AcademicSessionForStatistics {
  id: string;
  classId: string;
  name: string;
  colorKey: AcademicColorKey;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "closed";
  countsTowardAttendance: boolean;
}

export interface AttendanceForStatistics {
  id: string;
  sessionId: string;
  registeredAt: string;
  source: AttendanceOrigin;
  reviewStatus: "normal" | "suspicious";
  voidedAt: string | null;
}

export interface AttendanceOverrideForStatistics {
  sessionId: string;
  status: StudentAttendanceStatus;
}

export function deriveAttendanceStatus(
  attendance: Pick<AttendanceForStatistics, "reviewStatus" | "voidedAt"> | null | undefined,
): StudentAttendanceStatus {
  if (!attendance || attendance.voidedAt) return "absent";
  return attendance.reviewStatus === "suspicious" ? "suspicious" : "present";
}

export function deriveEffectiveAttendanceStatus(input: {
  eligible: boolean;
  attendance?: Pick<AttendanceForStatistics, "reviewStatus" | "voidedAt"> | null;
  overrideStatus?: StudentAttendanceStatus | null;
}): EffectiveAttendanceStatus {
  if (!input.eligible) return "not_applicable";
  if (input.overrideStatus) return input.overrideStatus;
  if (!input.attendance) return "not_registered";
  return deriveAttendanceStatus(input.attendance);
}

export function effectiveAttendanceCountsAsPresent(status: EffectiveAttendanceStatus): boolean {
  return status === "present" || status === "suspicious";
}

function activeAttendanceBySession(attendance: readonly AttendanceForStatistics[]) {
  const active = new Map<string, AttendanceForStatistics>();
  for (const record of attendance) {
    if (record.voidedAt) continue;
    const current = active.get(record.sessionId);
    if (!current || record.registeredAt > current.registeredAt) active.set(record.sessionId, record);
  }
  return active;
}

export function deriveEnrollmentAttendance(
  sessions: readonly AcademicSessionForStatistics[],
  attendance: readonly AttendanceForStatistics[],
  overrides: readonly AttendanceOverrideForStatistics[] = [],
): { attendance: StudentClassAttendanceStats; history: StudentSessionAttendance[] } {
  const activeBySession = activeAttendanceBySession(attendance);
  const overrideBySession = new Map(overrides.map((override) => [override.sessionId, override.status]));
  const history = sessions
    .filter((session) => (
      session.status === "closed"
      && session.closedAt !== null
      && session.countsTowardAttendance
    ))
    .map((session): StudentSessionAttendance => {
      const record = activeBySession.get(session.id);
      const effectiveStatus = deriveEffectiveAttendanceStatus({
        eligible: true,
        attendance: record,
        overrideStatus: overrideBySession.get(session.id),
      });
      return {
        sessionId: session.id,
        name: session.name,
        colorKey: session.colorKey,
        openedAt: session.openedAt,
        registeredAt: record?.registeredAt ?? null,
        status: effectiveStatus === "not_applicable" || effectiveStatus === "not_registered"
          ? "absent"
          : effectiveStatus,
        origin: record?.source ?? null,
      };
    })
    .sort((left, right) => right.openedAt.localeCompare(left.openedAt));

  let present = 0;
  let suspicious = 0;
  for (const row of history) {
    if (effectiveAttendanceCountsAsPresent(row.status)) present += 1;
    if (row.status === "suspicious") suspicious += 1;
  }
  const eligibleSessions = history.length;
  return {
    attendance: {
      present,
      absent: eligibleSessions - present,
      suspicious,
      eligibleSessions,
      percentage: attendancePercentage(present, eligibleSessions),
    },
    history,
  };
}

export function aggregateStudentAcademicSummary(classes: readonly StudentClassSummary[]): StudentAcademicSummary {
  const aggregate = aggregateAttendanceOpportunities(classes.map((course) => course.attendance));
  return {
    classes: [...classes],
    overall: {
      ...aggregate,
      classCount: classes.length,
    },
  };
}

export function aggregateAttendanceOpportunities(
  statistics: ReadonlyArray<Pick<StudentClassAttendanceStats, "present" | "eligibleSessions">>,
): { present: number; eligibleSessions: number; percentage: number | null } {
  let present = 0;
  let eligibleSessions = 0;
  for (const item of statistics) {
    present += item.present;
    eligibleSessions += item.eligibleSessions;
  }
  return { present, eligibleSessions, percentage: attendancePercentage(present, eligibleSessions) };
}

export function formatAttendancePercentage(value: number | null): string {
  if (value === null) return "—%";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)}%`;
}

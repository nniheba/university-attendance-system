import type { AcademicColorKey } from "@/lib/academic/colors";

export type SessionStatus = "open" | "closed";

export interface ClassRecord {
  id: string;
  name: string;
  teacher_name: string;
  teacher_id: string | null;
  group_name: string | null;
  academic_year: string | null;
  status: "active" | "archived";
  enrollment_mode: "closed" | "self_enroll";
  color_key: AcademicColorKey;
  updated_at: string;
  archived_at: string | null;
  created_at: string;
}

export interface ClassSummary extends ClassRecord {
  student_count: number;
  session_count: number;
  closed_session_count: number;
  average_attendance_percentage: number | null;
}

export type StudentAttendanceStatus = "present" | "absent" | "suspicious";
export type EffectiveAttendanceStatus = StudentAttendanceStatus | "not_registered" | "not_applicable";
export type AttendanceOrigin = "qr" | "manual";

export interface AttendanceOverrideRecord {
  id: string;
  class_id: string;
  session_id: string;
  enrollment_id: string;
  status: StudentAttendanceStatus;
  reason: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceOverrideAuditEntry {
  id: string;
  action: "set_override" | "change_override" | "clear_override";
  previousStatus: StudentAttendanceStatus | null;
  newStatus: StudentAttendanceStatus | null;
  reason: string;
  actorName: string;
  createdAt: string;
}

export interface StudentClassAttendanceStats {
  present: number;
  absent: number;
  suspicious: number;
  eligibleSessions: number;
  percentage: number | null;
}

export interface StudentSessionAttendance {
  sessionId: string;
  name: string;
  colorKey: AcademicColorKey;
  openedAt: string;
  registeredAt: string | null;
  status: StudentAttendanceStatus;
  origin: AttendanceOrigin | null;
}

export interface StudentClassSummary {
  id: string;
  name: string;
  groupName: string | null;
  academicYear: string | null;
  teacherName: string;
  colorKey: AcademicColorKey;
  status: "active" | "archived";
  enrollmentStatus: "active" | "inactive";
  attendance: StudentClassAttendanceStats;
}

export interface StudentClassDetail extends StudentClassSummary {
  history: StudentSessionAttendance[];
}

export interface StudentAcademicSummary {
  classes: StudentClassSummary[];
  overall: {
    present: number;
    eligibleSessions: number;
    percentage: number | null;
    classCount: number;
  };
}

export interface AttendanceMatrixCell {
  sessionId: string;
  enrollmentId: string;
  effectiveStatus: EffectiveAttendanceStatus;
  rawStatus: StudentAttendanceStatus;
  origin: AttendanceOrigin | null;
  registeredAt: string | null;
  gpsStatus: AttendanceRecord["gps_status"] | null;
  reviewStatus: AttendanceRecord["review_status"] | null;
  override: {
    id: string;
    status: StudentAttendanceStatus;
    reason: string;
    updatedAt: string;
  } | null;
  audit: AttendanceOverrideAuditEntry[];
}

export interface AttendanceMatrixRow {
  enrollmentId: string;
  studentEmail: string;
  displayName: string;
  enrollmentStatus: "active" | "inactive";
  cells: AttendanceMatrixCell[];
  attendance: StudentClassAttendanceStats;
}

export interface AttendanceMatrixSession {
  id: string;
  name: string;
  colorKey: AcademicColorKey;
  openedAt: string;
  closedAt: string;
  enableProjectionBubbles: boolean;
  summary: StudentClassAttendanceStats;
}

export interface AttendanceMatrixData {
  class: Pick<ClassRecord, "id" | "name" | "group_name" | "academic_year" | "status" | "color_key">;
  sessions: AttendanceMatrixSession[];
  rows: AttendanceMatrixRow[];
}

export interface EnrollmentRecord {
  id: string;
  class_id: string;
  student_email: string;
  student_user_id: string | null;
  status: "active" | "inactive";
  enrolled_at: string;
  unenrolled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrollmentView {
  enrollmentId: string;
  email: string;
  displayName: string;
  registered: boolean;
  status: "active" | "inactive";
  enrolledAt: string;
}

export interface SessionRecord {
  id: string;
  class_id: string;
  session_name: string | null;
  color_key: AcademicColorKey;
  opened_at: string;
  closed_at: string | null;
  status: SessionStatus;
  latitude: number | null;
  longitude: number | null;
  allowed_radius_m: number | null;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  location_country_code: string | null;
  counts_toward_attendance: boolean;
  allow_self_enrollment: boolean;
  enable_projection_bubbles: boolean;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_user_id: string | null;
  full_name: string;
  normalized_name: string;
  registered_at: string;
  qr_verified: boolean;
  location_verified: boolean;
  location_accuracy: number | null;
  distance_from_center_m: number | null;
  network_city: string | null;
  network_region: string | null;
  network_country: string | null;
  network_country_code: string | null;
  network_location_status: "consistent" | "mismatch" | "unknown";
  source: "qr" | "manual";
  student_email_snapshot: string | null;
  review_status: "normal" | "suspicious";
  teacher_note: string | null;
  manual_reason: string | null;
  created_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  gps_status: "not_shared" | "shared" | "verified" | "outside" | "inaccurate" | "unavailable";
  created_at: string;
}

export interface SessionView extends SessionRecord {
  class: ClassRecord;
  attendance: AttendanceRecord[];
}

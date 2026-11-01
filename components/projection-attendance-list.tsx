import Image from "next/image";

import type { AttendanceRecord } from "@/lib/types";

type ProjectionAttendance = Pick<AttendanceRecord, "id" | "student_user_id" | "full_name" | "registered_at">;

const RECENT_REGISTRATION_LIMIT = 8;

export function projectionRecentAttendance(
  attendance: readonly ProjectionAttendance[],
  limit = RECENT_REGISTRATION_LIMIT,
): ProjectionAttendance[] {
  return [...attendance]
    .sort((left, right) => right.registered_at.localeCompare(left.registered_at))
    .slice(0, Math.max(0, limit));
}

export function studentInitials(name: string): string {
  const initials = name.trim().split(/\s+/u).slice(0, 2).map((part) => part[0] ?? "").join("");
  return initials.toLocaleUpperCase("es") || "E";
}

export function ProjectionStudentAvatar({
  studentUserId,
  fullName,
  className = "size-11",
}: {
  studentUserId: string | null;
  fullName: string;
  className?: string;
}) {
  return studentUserId ? (
    <Image
      src="/avatars/student-profile.svg"
      width={44}
      height={44}
      alt=""
      aria-hidden="true"
      className={`projection-profile-avatar rounded-full border border-sky-200 bg-white object-cover shadow-sm ${className}`}
    />
  ) : (
    <span aria-hidden="true" className={`projection-profile-avatar grid place-items-center rounded-full border border-sky-200 bg-[var(--campus-blue-soft)] text-sm font-bold text-[var(--campus-blue-deep)] shadow-sm ${className}`}>
      {studentInitials(fullName)}
    </span>
  );
}

export function ProjectionAttendanceList({
  attendance,
  recentAttendanceIds,
}: {
  attendance: ProjectionAttendance[];
  recentAttendanceIds: readonly string[];
}) {
  const recent = projectionRecentAttendance(attendance);
  const animatedIds = new Set(recentAttendanceIds);

  return (
    <section className="flex h-full min-h-[320px] flex-col overflow-hidden border border-[var(--campus-border)] bg-white min-[900px]:min-h-0" aria-labelledby="projection-students-title">
      <div className="flex items-center justify-between gap-4 border-b-2 border-b-[var(--campus-blue)] px-5 py-4">
        <h2 id="projection-students-title" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-navy)] sm:text-base">Estudiantes registrados</h2>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-[var(--campus-blue-dark)]">Presentes: {attendance.length}</span>
      </div>
      {attendance.length === 0 ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-[var(--campus-muted)]">Esperando registros de estudiantes…</div>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-[var(--campus-neutral-200)] overflow-y-auto" aria-live="polite" aria-relevant="additions text">
          {recent.map((record) => (
            <li
              key={record.id}
              className={`grid grid-cols-[3rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 sm:px-5 ${animatedIds.has(record.id) ? "projection-attendance-entry" : ""}`}
            >
              <ProjectionStudentAvatar studentUserId={record.student_user_id} fullName={record.full_name} />
              <span className="min-w-0 truncate text-base font-semibold text-[var(--campus-navy)] sm:text-lg">{record.full_name}</span>
              <time dateTime={record.registered_at} className="tabular-nums text-[var(--campus-muted)]">{formatProjectionTime(record.registered_at)}</time>
              <span className="text-lg font-bold text-[var(--campus-success)]" aria-label="Asistencia registrada">
                ✓
              </span>
            </li>
          ))}
        </ol>
      )}
      {attendance.length > recent.length && <p className="border-t border-[var(--campus-border)] px-5 py-2 text-xs text-[var(--campus-muted)]">Mostrando los {recent.length} registros más recientes.</p>}
    </section>
  );
}

function formatProjectionTime(value: string): string {
  return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

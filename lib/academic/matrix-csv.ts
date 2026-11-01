import type { AttendanceMatrixData, EffectiveAttendanceStatus } from "@/lib/types";
import { csvDocument, csvSlug, MADRID_TIME_ZONE } from "@/lib/academic/csv";

export function effectiveStatusCsvLabel(status: EffectiveAttendanceStatus): string {
  if (status === "present") return "Presente";
  if (status === "absent") return "Ausente";
  if (status === "not_registered") return "No registró";
  if (status === "suspicious") return "Sospechosa";
  return "No aplica";
}

function sessionHeading(name: string, openedAt: string): string {
  const date = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    timeZone: MADRID_TIME_ZONE,
  }).format(new Date(openedAt)).replace(".", "").toUpperCase();
  const time = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MADRID_TIME_ZONE,
  }).format(new Date(openedAt));
  return `${name} · ${date} ${time}`;
}

export function attendanceMatrixCsv(matrix: AttendanceMatrixData): string {
  const header = [
    "Asignatura",
    "Grupo",
    "Periodo académico",
    "Estudiante",
    "Correo",
    ...matrix.sessions.map((session) => sessionHeading(session.name, session.openedAt)),
    "% Asistencia",
  ];
  const rows = matrix.rows.map((row) => [
    matrix.class.name,
    matrix.class.group_name ?? "—",
    matrix.class.academic_year ?? "—",
    row.displayName,
    row.studentEmail,
    ...row.cells.map((cell) => effectiveStatusCsvLabel(cell.effectiveStatus)),
    row.attendance.percentage === null ? "" : `${row.attendance.percentage.toFixed(2)}%`,
  ]);
  return csvDocument([header, ...rows]);
}

export function matrixCsvFilename(course: Pick<AttendanceMatrixData["class"], "name" | "group_name" | "academic_year">): string {
  return `${csvSlug([course.name, course.group_name, course.academic_year], "asignatura")}-matriz-asistencia.csv`;
}

import { csvDocument, csvSlug, madridDateParts } from "@/lib/academic/csv";
import { sessionDisplayName } from "@/lib/academic/colors";

interface SessionCsvAttendance {
  full_name: string;
  student_email_snapshot: string | null;
  registered_at: string;
  source: "qr" | "manual";
  review_status: "normal" | "suspicious";
  gps_status: string;
}

interface SessionCsvContext {
  sessionName: string | null;
  openedAt: string;
  course: {
    name: string;
    groupName: string | null;
    academicYear: string | null;
  };
}

export function sessionAttendanceCsv(
  context: SessionCsvContext,
  attendance: readonly SessionCsvAttendance[],
): string {
  const sessionDate = madridDateParts(context.openedAt);
  const sessionName = sessionDisplayName(context.sessionName);
  const header = [
    "Nombre completo",
    "Correo institucional",
    "Asignatura",
    "Grupo",
    "Periodo académico",
    "Sesión",
    "Fecha de sesión",
    "Hora de sesión",
    "Hora de registro",
    "Origen",
    "Estado",
    "Ubicación",
  ];
  const rows = attendance.map((record) => [
    record.full_name,
    record.student_email_snapshot ?? "—",
    context.course.name,
    context.course.groupName ?? "—",
    context.course.academicYear ?? "—",
    sessionName,
    sessionDate.date,
    sessionDate.time,
    madridDateParts(record.registered_at).time,
    record.source === "manual" ? "Manual" : "QR",
    record.review_status === "suspicious" ? "Sospechosa" : "Normal",
    gpsLabel(record.gps_status),
  ]);
  return csvDocument([header, ...rows]);
}

export function sessionCsvFilename(context: SessionCsvContext): string {
  const sessionDate = madridDateParts(context.openedAt);
  return `${csvSlug([context.course.name, sessionDisplayName(context.sessionName), sessionDate.isoDate], "asistencia")}.csv`;
}

function gpsLabel(status: string): string {
  if (status === "verified") return "Compatible";
  if (status === "outside") return "Fuera de zona";
  if (status === "inaccurate") return "Imprecisa";
  if (status === "shared") return "Compartida sin referencia";
  if (status === "unavailable") return "No disponible";
  return "No compartida";
}

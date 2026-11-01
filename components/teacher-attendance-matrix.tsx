"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { formatAttendancePercentage } from "@/lib/academic/attendance-statistics";
import { PendingButtonLabel } from "@/components/institutional-loading";
import { InstitutionalDialog } from "@/components/institutional-dialog";
import { AcademicColorPicker } from "@/components/academic-color-picker";
import { createBrowserClient } from "@/lib/supabase/browser";
import { teacherAvatarPath, type TeacherAvatarKey } from "@/lib/teacher-profile";
import type {
  AttendanceMatrixCell,
  AttendanceMatrixData,
  AttendanceMatrixRow,
  EffectiveAttendanceStatus,
  StudentAttendanceStatus,
} from "@/lib/types";
import { academicColor, type AcademicColorKey } from "@/lib/academic/colors";
import { madridDateTimeInput, madridLocalDateTimeToIso } from "@/lib/academic/madrid-time";

interface TeacherIdentity {
  email: string;
  name: string;
  avatarKey: TeacherAvatarKey;
}

type RowStatusFilter = "all" | "absences" | "suspicious";
type PercentageFilter = "all" | "below80" | "below70";
type RowSort = "alphabetical" | "lowest" | "highest";

interface SessionEdit {
  id: string;
  name: string;
  date: string;
  time: string;
  colorKey: AcademicColorKey;
  enableProjectionBubbles: boolean;
  originalOpenedAt: string;
}

const STATUS_PRESENTATION: Record<EffectiveAttendanceStatus, {
  short: string;
  label: string;
  className: string;
}> = {
  present: { short: "✓", label: "Presente", className: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100" },
  absent: { short: "✕", label: "Ausente", className: "bg-rose-50 text-rose-900 hover:bg-rose-100" },
  not_registered: { short: "○", label: "No registró", className: "bg-sky-50 text-sky-950 hover:bg-sky-100" },
  suspicious: { short: "!", label: "En revisión", className: "bg-amber-50 text-amber-900 hover:bg-amber-100" },
  not_applicable: { short: "—", label: "No aplica", className: "bg-slate-50 text-slate-500 hover:bg-slate-100" },
};

function sessionDate(value: string): { compact: string; time: string; full: string } {
  const date = new Date(value);
  return {
    compact: new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", timeZone: "Europe/Madrid" })
      .format(date).replace(".", "").toUpperCase(),
    time: new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid" }).format(date),
    full: new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Madrid" }).format(date),
  };
}

function visibleSessionSummary(rows: readonly AttendanceMatrixRow[], index: number) {
  let eligible = 0;
  let present = 0;
  let absent = 0;
  let suspicious = 0;
  for (const row of rows) {
    const status = row.cells[index]?.effectiveStatus;
    if (!status || status === "not_applicable") continue;
    eligible += 1;
    if (status === "present" || status === "suspicious") present += 1;
    if (status === "absent" || status === "not_registered") absent += 1;
    if (status === "suspicious") suspicious += 1;
  }
  return { eligible, present, absent, suspicious, percentage: eligible ? Math.round(present / eligible * 10_000) / 100 : null };
}

function rawLabel(cell: AttendanceMatrixCell): string {
  if (!cell.origin) return "No registró";
  return STATUS_PRESENTATION[cell.rawStatus].label;
}

function auditStatusLabel(status: StudentAttendanceStatus | null): string {
  return status ? STATUS_PRESENTATION[status].label : "Valor original";
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "La operación no se pudo completar.");
  return body;
}

export function TeacherAttendanceMatrix({
  initialMatrix,
  teacher,
}: {
  initialMatrix: AttendanceMatrixData;
  teacher: TeacherIdentity;
}) {
  const router = useRouter();
  const [matrix, setMatrix] = useState(initialMatrix);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RowStatusFilter>("all");
  const [percentageFilter, setPercentageFilter] = useState<PercentageFilter>("all");
  const [sort, setSort] = useState<RowSort>("alphabetical");
  const [selected, setSelected] = useState<{ row: AttendanceMatrixRow; cell: AttendanceMatrixCell; sessionIndex: number } | null>(null);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [sessionEdit, setSessionEdit] = useState<SessionEdit | null>(null);
  const [removal, setRemoval] = useState<AttendanceMatrixData["sessions"][number] | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [removalError, setRemovalError] = useState("");
  const [removalBusy, setRemovalBusy] = useState(false);
  const [enrollmentAction, setEnrollmentAction] = useState<AttendanceMatrixRow | null>(null);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return matrix.rows
      .filter((row) => showInactive || row.enrollmentStatus === "active")
      .filter((row) => !needle || `${row.displayName} ${row.studentEmail}`.toLocaleLowerCase("es").includes(needle))
      .filter((row) => statusFilter === "all"
        || (statusFilter === "absences" && row.attendance.absent > 0)
        || (statusFilter === "suspicious" && row.attendance.suspicious > 0))
      .filter((row) => percentageFilter === "all"
        || (row.attendance.percentage !== null && row.attendance.percentage < (percentageFilter === "below80" ? 80 : 70)))
      .sort((left, right) => {
        if (sort === "lowest") return (left.attendance.percentage ?? Number.POSITIVE_INFINITY) - (right.attendance.percentage ?? Number.POSITIVE_INFINITY);
        if (sort === "highest") return (right.attendance.percentage ?? Number.NEGATIVE_INFINITY) - (left.attendance.percentage ?? Number.NEGATIVE_INFINITY);
        return left.displayName.localeCompare(right.displayName, "es", { sensitivity: "base" });
      });
  }, [matrix.rows, percentageFilter, search, showInactive, sort, statusFilter]);

  async function applyOverride(action: "set_status" | "clear_override", status?: StudentAttendanceStatus) {
    if (!selected || !reason.trim()) {
      setDialogError("Indica el motivo de la corrección.");
      return;
    }
    setBusy(true);
    setDialogError("");
    try {
      const response = await fetch(`/api/classes/${matrix.class.id}/attendance-matrix`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sessionId: selected.cell.sessionId,
          enrollmentId: selected.row.enrollmentId,
          status,
          reason,
        }),
      });
      const body = await responseJson<{ matrix: AttendanceMatrixData }>(response);
      setMatrix(body.matrix);
      const updatedRow = body.matrix.rows.find((row) => row.enrollmentId === selected.row.enrollmentId);
      const updatedCell = updatedRow?.cells.find((cell) => cell.sessionId === selected.cell.sessionId);
      if (updatedRow && updatedCell) setSelected({ row: updatedRow, cell: updatedCell, sessionIndex: selected.sessionIndex });
      setReason("");
      setMessage("Corrección guardada y auditada.");
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "No se pudo guardar la corrección.");
    } finally {
      setBusy(false);
    }
  }

  function openSessionEditor(sessionIndex: number) {
    const session = matrix.sessions[sessionIndex];
    const localDateTime = madridDateTimeInput(session.openedAt);
    if (!localDateTime) {
      setMessage("No se pudo interpretar la fecha de esta sesión.");
      return;
    }
    setDialogError("");
    setSessionEdit({
      id: session.id,
      name: session.name,
      date: localDateTime.date,
      time: localDateTime.time,
      colorKey: session.colorKey,
      enableProjectionBubbles: session.enableProjectionBubbles,
      originalOpenedAt: session.openedAt,
    });
  }

  async function saveSessionDetails() {
    if (!sessionEdit) return;
    const originalLocalDateTime = madridDateTimeInput(sessionEdit.originalOpenedAt);
    const openedAt = originalLocalDateTime?.date === sessionEdit.date && originalLocalDateTime.time === sessionEdit.time
      ? sessionEdit.originalOpenedAt
      : madridLocalDateTimeToIso(sessionEdit.date, sessionEdit.time);
    if (!sessionEdit.name.trim() || sessionEdit.name.trim().length > 120) {
      setDialogError("Indica un nombre de sesión de hasta 120 caracteres.");
      return;
    }
    if (!openedAt) {
      setDialogError("La fecha y hora no son válidas en la zona horaria Europe/Madrid.");
      return;
    }

    setBusy(true);
    setDialogError("");
    try {
      await responseJson(await fetch(`/api/sessions/${sessionEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_details",
          sessionName: sessionEdit.name,
          openedAt,
          colorKey: sessionEdit.colorKey,
          enableProjectionBubbles: sessionEdit.enableProjectionBubbles,
        }),
      }));
      const refreshed = await responseJson<{ matrix: AttendanceMatrixData }>(
        await fetch(`/api/classes/${matrix.class.id}/attendance-matrix`, { cache: "no-store" }),
      );
      setMatrix(refreshed.matrix);
      const refreshedIndex = refreshed.matrix.sessions.findIndex((session) => session.id === sessionEdit.id);
      setSelectedSession(refreshedIndex >= 0 ? refreshedIndex : null);
      setSessionEdit(null);
      setMessage("Sesión actualizada. La matriz y sus periodos se han recalculado.");
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "No se pudo actualizar la sesión.");
    } finally {
      setBusy(false);
    }
  }

  function openRemoval(session: AttendanceMatrixData["sessions"][number]) {
    setRemoval(session);
    setRemovalReason("");
    setRemovalError("");
    setMessage("");
  }

  async function confirmRemoval() {
    if (!removal) return;
    const normalizedReason = removalReason.trim();
    if (!normalizedReason || normalizedReason.length > 500) {
      setRemovalError("Indica un motivo de eliminación de hasta 500 caracteres.");
      return;
    }
    setRemovalBusy(true);
    setRemovalError("");
    try {
      await responseJson(await fetch(`/api/sessions/${removal.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: normalizedReason }),
      }));
      const refreshed = await responseJson<{ matrix: AttendanceMatrixData }>(
        await fetch(`/api/classes/${matrix.class.id}/attendance-matrix`, { cache: "no-store" }),
      );
      setMatrix(refreshed.matrix);
      setSelected(null);
      setSelectedSession(null);
      setSessionEdit(null);
      setRemoval(null);
      setRemovalReason("");
      setMessage("La sesión fue retirada de la matriz y los porcentajes se recalcularon.");
    } catch (error) {
      setRemovalError(error instanceof Error ? error.message : "No se pudo completar la eliminación.");
    } finally {
      setRemovalBusy(false);
    }
  }

  async function updateEnrollment(row: AttendanceMatrixRow, action: "deactivate" | "reactivate") {
    setEnrollmentBusy(true);
    setEnrollmentError("");
    setMessage("");
    try {
      await responseJson(await fetch(`/api/classes/${matrix.class.id}/students/${row.enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }));
      const refreshed = await responseJson<{ matrix: AttendanceMatrixData }>(
        await fetch(`/api/classes/${matrix.class.id}/attendance-matrix`, { cache: "no-store" }),
      );
      setMatrix(refreshed.matrix);
      setSelected(null);
      setEnrollmentAction(null);
      setMessage(action === "deactivate"
        ? "La matrícula quedó inactiva. El historial académico se conserva."
        : "La matrícula volvió a estar activa.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "No se pudo actualizar la matrícula.";
      if (action === "deactivate") setEnrollmentError(detail);
      else setMessage(detail);
    } finally {
      setEnrollmentBusy(false);
    }
  }

  async function signOut() {
    await createBrowserClient()?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const selectedSessionData = selectedSession === null ? null : matrix.sessions[selectedSession];
  const selectedSessionSummary = selectedSession === null ? null : visibleSessionSummary(rows, selectedSession);

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader
        role="teacher"
        homeHref="/teacher"
        identity={{ ...teacher, avatarSrc: teacherAvatarPath(teacher.avatarKey), href: "/teacher/profile" }}
        actions={<button onClick={() => void signOut()} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Cerrar sesión</button>}
      />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/teacher" }, { label: "Mis asignaturas", href: "/teacher#asignaturas" }, { label: matrix.class.name, href: `/teacher/classes/${matrix.class.id}` }, { label: "Matriz de asistencia" }]} />
        <Link href={`/teacher/classes/${matrix.class.id}`} className="mt-5 inline-flex min-h-11 items-center font-semibold text-[var(--campus-blue-dark)]">← Volver a {matrix.class.name}</Link>
        <header className={`campus-panel mt-3 border-t-4 p-5 sm:p-7 ${academicColor(matrix.class.color_key).borderClass}`}>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-[var(--campus-blue-dark)]">Matriz académica</p>
              <h1 className="mt-2 text-3xl font-semibold text-[var(--campus-navy)]">{matrix.class.name}</h1>
              <p className="mt-2 text-[var(--campus-muted)]">{matrix.class.group_name || "Sin grupo"}{matrix.class.academic_year ? ` · ${matrix.class.academic_year}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/teacher/classes/${matrix.class.id}`} className="campus-secondary-button">Volver</Link>
              <a href={`/api/classes/${matrix.class.id}/attendance-matrix/export`} className="campus-primary-button">Exportar CSV</a>
            </div>
          </div>
        </header>

        <section aria-label="Filtros de la matriz" className="campus-panel mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-semibold text-[var(--campus-navy)]">Buscar estudiante<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
          <label className="text-sm font-semibold text-[var(--campus-navy)]">Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RowStatusFilter)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal"><option value="all">Todos</option><option value="absences">Con ausencias</option><option value="suspicious">Con registros en revisión</option></select></label>
          <label className="text-sm font-semibold text-[var(--campus-navy)]">Asistencia<select value={percentageFilter} onChange={(event) => setPercentageFilter(event.target.value as PercentageFilter)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal"><option value="all">Todos</option><option value="below80">Por debajo de 80%</option><option value="below70">Por debajo de 70%</option></select></label>
          <label className="text-sm font-semibold text-[var(--campus-navy)]">Orden<select value={sort} onChange={(event) => setSort(event.target.value as RowSort)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal"><option value="alphabetical">Alfabético A–Z</option><option value="lowest">Menor asistencia</option><option value="highest">Mayor asistencia</option></select></label>
          <label className="flex min-h-11 items-center gap-3 self-end text-sm font-semibold text-[var(--campus-navy)]"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="h-5 w-5" />Mostrar inactivos</label>
        </section>

        {message && <p role="status" className="mt-4 border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-4 py-3 text-sm">{message}</p>}
        {selectedSessionData && selectedSessionSummary && (
          <section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[5px] border border-[var(--campus-border)] bg-white p-4 text-sm">
            <div><strong className="flex items-center gap-2 text-[var(--campus-navy)]"><span aria-hidden="true" className={`size-3 rounded-full ${academicColor(selectedSessionData.colorKey).markerClass}`} />{selectedSessionData.name}</strong><p className="mt-1 text-[var(--campus-muted)]">{sessionDate(selectedSessionData.openedAt).full} · resumen de los estudiantes visibles</p></div>
            <div className="flex flex-wrap gap-x-5 gap-y-2"><span>Elegibles: <strong>{selectedSessionSummary.eligible}</strong></span><span>Presentes: <strong>{selectedSessionSummary.present}</strong></span><span>Ausentes: <strong>{selectedSessionSummary.absent}</strong></span><span>En revisión: <strong>{selectedSessionSummary.suspicious}</strong></span><span>Asistencia: <strong>{formatAttendancePercentage(selectedSessionSummary.percentage)}</strong></span></div>
            <div className="flex gap-3">
              <button className="campus-secondary-button" onClick={() => openSessionEditor(selectedSession!)}>Editar sesión</button>
              <button className="campus-danger-button" onClick={() => openRemoval(selectedSessionData)}>Eliminar sesión</button>
              <button className="font-semibold text-[var(--campus-blue-dark)]" onClick={() => setSelectedSession(null)}>Cerrar</button>
            </div>
          </section>
        )}

        <section className="campus-panel mt-6 overflow-hidden" aria-labelledby="matrix-title">
          <div className="border-b border-[var(--campus-border)] px-5 py-4 sm:px-7"><h2 id="matrix-title" className="text-xl font-semibold text-[var(--campus-navy)]">Asistencia por sesión</h2><p className="mt-1 text-sm text-[var(--campus-muted)]">{rows.length} estudiantes visibles · {matrix.sessions.length} sesiones cerradas computables</p></div>
          {matrix.sessions.length === 0 ? <p className="p-8 text-center text-[var(--campus-muted)]">Todavía no hay sesiones cerradas computables.</p> : rows.length === 0 ? <p className="p-8 text-center text-[var(--campus-muted)]">Ningún estudiante coincide con los filtros.</p> : (
            <div className="max-h-[70vh] overflow-auto" tabIndex={0} aria-label="Matriz de asistencia con desplazamiento horizontal">
              <table className="min-w-max border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 top-0 z-30 min-w-64 border-b border-r border-[var(--campus-border)] bg-slate-100 px-4 py-3 text-left text-[var(--campus-navy)]">Estudiante</th>
                    {matrix.sessions.map((session, index) => { const date = sessionDate(session.openedAt); return <th key={session.id} scope="col" className="sticky top-0 z-20 min-w-40 border-b border-r border-[var(--campus-border)] bg-slate-100 p-0 text-center text-[var(--campus-navy)]"><button className="w-full px-3 py-2 hover:bg-slate-200" onClick={() => setSelectedSession(index)} aria-label={`Ver resumen de ${session.name}, ${date.full}`}><span className="flex items-center justify-center gap-2 font-semibold"><span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${academicColor(session.colorKey).markerClass}`} /><span className="max-w-36 truncate">{session.name}</span></span><span className="mt-1 block text-xs font-normal text-[var(--campus-muted)]">{date.compact} · {date.time}</span></button></th>; })}
                    <th scope="col" className="sticky right-0 top-0 z-30 min-w-28 border-b border-l border-[var(--campus-border)] bg-slate-100 px-4 py-3 text-center text-[var(--campus-navy)]">Asistencia</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => <tr key={row.enrollmentId}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-[var(--campus-border)] bg-white px-4 py-3 text-left">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0"><span className="block truncate font-semibold text-[var(--campus-navy)]">{row.displayName}</span><span className="mt-1 block truncate text-xs font-normal text-[var(--campus-muted)]">{row.studentEmail}</span></span>
                        <button type="button" disabled={enrollmentBusy} onClick={() => { if (row.enrollmentStatus === "active") { setEnrollmentError(""); setEnrollmentAction(row); } else { void updateEnrollment(row, "reactivate"); } }} className="campus-secondary-button min-h-9 shrink-0 px-2 text-xs disabled:opacity-60" aria-label={`${row.enrollmentStatus === "active" ? "Desactivar" : "Activar"} a ${row.displayName}`}>{row.enrollmentStatus === "active" ? "Desactivar" : "Activar"}</button>
                      </span>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${row.enrollmentStatus === "active" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{row.enrollmentStatus === "active" ? "Activo" : "Inactivo"}</span>
                    </th>
                    {row.cells.map((cell, index) => { const presentation = STATUS_PRESENTATION[cell.effectiveStatus]; return <td key={cell.sessionId} className="border-b border-r border-[var(--campus-border)] p-1 text-center"><button onClick={() => { setSelected({ row, cell, sessionIndex: index }); setReason(""); setMessage(""); setDialogError(""); }} className={`min-h-14 w-full min-w-20 rounded-[4px] px-2 py-2 font-semibold transition-colors ${presentation.className}`} aria-label={`${row.displayName}: ${presentation.label} el ${sessionDate(matrix.sessions[index].openedAt).full}`}><span aria-hidden="true" className="block text-lg">{presentation.short}</span><span className="block text-xs">{presentation.label}</span></button></td>; })}
                    <td className="sticky right-0 z-10 border-b border-l border-[var(--campus-border)] bg-white px-4 py-3 text-center font-bold text-[var(--campus-navy)]">{formatAttendancePercentage(row.attendance.percentage)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <InstitutionalFooter />

      <InstitutionalDialog
        open={Boolean(removal)}
        title="Eliminar sesión de la matriz"
        description={removal ? `${removal.name} · ${sessionDate(removal.openedAt).full}` : undefined}
        tone="danger"
        confirmLabel="ELIMINAR SESIÓN"
        pendingLabel="Eliminando…"
        busy={removalBusy}
        error={removalError}
        confirmDisabled={!removalReason.trim() || removalReason.trim().length > 500}
        onConfirm={() => void confirmRemoval()}
        onCancel={() => { if (!removalBusy) setRemoval(null); }}
      >
        {removal && (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-[var(--campus-text)]">
              Esta sesión dejará de aparecer en la matriz y dejará de contar para los porcentajes de asistencia. Los registros de asistencia existentes se conservarán internamente para auditoría.
            </p>
            <label className="block text-sm font-semibold text-[var(--campus-navy)]">
              Motivo de eliminación
              <textarea data-dialog-autofocus required minLength={1} maxLength={500} rows={4} value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} className="mt-2 w-full rounded-[5px] border border-[var(--campus-border)] p-3 font-normal" placeholder="Describe brevemente el motivo." />
            </label>
          </div>
        )}
      </InstitutionalDialog>

      <InstitutionalDialog
        open={Boolean(enrollmentAction)}
        title="Desactivar matrícula"
        description={`${enrollmentAction?.displayName ?? "El estudiante"} dejará de participar en nuevas sesiones hasta que la matrícula sea reactivada. Su historial anterior se conservará.`}
        tone="warning"
        confirmLabel="Desactivar matrícula"
        pendingLabel="Desactivando matrícula…"
        busy={enrollmentBusy}
        error={enrollmentError}
        onCancel={() => { if (!enrollmentBusy) { setEnrollmentAction(null); setEnrollmentError(""); } }}
        onConfirm={() => { if (enrollmentAction) void updateEnrollment(enrollmentAction, "deactivate"); }}
      />

      <InstitutionalDialog
        open={Boolean(selected)}
        title={selected?.row.displayName ?? "Detalle académico"}
        description={selected ? <><span className="flex items-center gap-2 font-semibold text-[var(--campus-navy)]"><span aria-hidden="true" className={`size-2.5 rounded-full ${academicColor(matrix.sessions[selected.sessionIndex].colorKey).markerClass}`} />{matrix.sessions[selected.sessionIndex].name}</span><span className="mt-1 block">{sessionDate(matrix.sessions[selected.sessionIndex].openedAt).full}</span></> : undefined}
        busy={busy}
        error={dialogError}
        onCancel={() => { if (!busy) setSelected(null); }}
        footer={<button type="button" disabled={busy} onClick={() => setSelected(null)} className="campus-secondary-button">Cerrar</button>}
      >
        {selected && (
          <>
            <dl className="mt-6 grid gap-3 rounded-[5px] bg-slate-50 p-4 sm:grid-cols-2">
              <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Estado efectivo</dt><dd className="mt-1 font-semibold">{STATUS_PRESENTATION[selected.cell.effectiveStatus].label}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Estado original</dt><dd className="mt-1 font-semibold">{rawLabel(selected.cell)}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Origen</dt><dd className="mt-1">{selected.cell.origin === "qr" ? "QR" : selected.cell.origin === "manual" ? "Manual" : "Sin registro"}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Corrección docente</dt><dd className="mt-1">{selected.cell.override ? "Sí" : "No"}</dd></div>
              {selected.cell.registeredAt && <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Registro</dt><dd className="mt-1">{sessionDate(selected.cell.registeredAt).full}</dd></div>}
              {selected.cell.gpsStatus && <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Evidencia GPS</dt><dd className="mt-1">{selected.cell.gpsStatus}</dd></div>}
              {selected.cell.reviewStatus && <div><dt className="text-xs font-bold uppercase text-[var(--campus-muted)]">Revisión original</dt><dd className="mt-1">{selected.cell.reviewStatus === "suspicious" ? "Sospechosa" : "Normal"}</dd></div>}
            </dl>

            {selected.cell.effectiveStatus === "not_applicable" ? <p className="mt-5 rounded-[5px] bg-slate-100 p-4 text-sm text-slate-700">No aplica: la sesión queda fuera de los periodos de matrícula. Esta celda no admite correcciones.</p> : (
              <div className="mt-6">
                <label className="text-sm font-semibold text-[var(--campus-navy)]">Motivo de la corrección<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-[5px] border border-[var(--campus-border)] p-3 font-normal" placeholder="Describe brevemente el motivo." /></label>
                {busy && <p role="status" className="mt-3 text-sm font-semibold text-[var(--campus-blue-dark)]"><PendingButtonLabel>Guardando corrección…</PendingButtonLabel></p>}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button disabled={busy} onClick={() => void applyOverride("set_status", "present")} className="min-h-11 rounded-[4px] bg-emerald-100 px-4 font-semibold text-emerald-950">Asistió</button>
                  <button disabled={busy} onClick={() => void applyOverride("set_status", "absent")} className="min-h-11 rounded-[4px] bg-rose-100 px-4 font-semibold text-rose-950">No asistió</button>
                  <button disabled={busy} onClick={() => void applyOverride("set_status", "suspicious")} className="min-h-11 rounded-[4px] bg-amber-100 px-4 font-semibold text-amber-950">Sospechosa</button>
                  <button disabled={busy || !selected.cell.override} onClick={() => void applyOverride("clear_override")} className="campus-secondary-button disabled:opacity-50">Restablecer original</button>
                </div>
              </div>
            )}

            <section className="mt-7 border-t border-[var(--campus-border)] pt-5"><h3 className="text-sm font-bold uppercase tracking-wide text-[var(--campus-navy)]">Historial de cambios</h3>{selected.cell.audit.length === 0 ? <p className="mt-3 text-sm text-[var(--campus-muted)]">Sin correcciones registradas.</p> : <ol className="mt-3 space-y-3">{selected.cell.audit.map((entry) => <li key={entry.id} className="rounded-[5px] border border-[var(--campus-border)] p-3 text-sm"><p className="font-semibold text-[var(--campus-navy)]">{auditStatusLabel(entry.previousStatus)} → {auditStatusLabel(entry.newStatus)}</p><p className="mt-1 text-[var(--campus-muted)]">{entry.actorName} · {sessionDate(entry.createdAt).full}</p><p className="mt-2">“{entry.reason}”</p></li>)}</ol>}</section>
          </>
        )}
      </InstitutionalDialog>

      <InstitutionalDialog
        open={Boolean(sessionEdit)}
        title="Editar sesión"
        description="Actualiza la identidad académica y la fecha efectiva de la sesión. La matriz se recalculará al guardar."
        confirmLabel="GUARDAR CAMBIOS"
        pendingLabel="Guardando sesión…"
        busy={busy}
        error={dialogError}
        confirmDisabled={!sessionEdit?.name.trim()}
        onConfirm={() => void saveSessionDetails()}
        onCancel={() => { if (!busy) setSessionEdit(null); }}
      >
        {sessionEdit && (
          <div className="space-y-5">
            <label className="block text-sm font-semibold text-[var(--campus-navy)]">
              Nombre de la sesión
              <input data-dialog-autofocus required maxLength={120} value={sessionEdit.name} onChange={(event) => setSessionEdit({ ...sessionEdit, name: event.target.value })} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-[var(--campus-navy)]">Fecha<input required type="date" value={sessionEdit.date} onChange={(event) => setSessionEdit({ ...sessionEdit, date: event.target.value })} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
              <label className="text-sm font-semibold text-[var(--campus-navy)]">Hora<input required type="time" value={sessionEdit.time} onChange={(event) => setSessionEdit({ ...sessionEdit, time: event.target.value })} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
            </div>
            <p className="text-xs text-[var(--campus-muted)]">Zona horaria: Europe/Madrid.</p>
            <AcademicColorPicker legend="Color de la sesión" name="session-edit-color" value={sessionEdit.colorKey} onChange={(colorKey) => setSessionEdit({ ...sessionEdit, colorKey })} />
            <label className="flex items-start gap-3 border-t border-[var(--campus-border)] pt-5 text-sm text-[var(--campus-navy)]">
              <input type="checkbox" checked={sessionEdit.enableProjectionBubbles} onChange={(event) => setSessionEdit({ ...sessionEdit, enableProjectionBubbles: event.target.checked })} className="mt-0.5 size-5 shrink-0 accent-[var(--campus-blue)]" />
              <span><span className="block font-semibold">Animación de registros en proyección</span><span className="mt-1 block leading-6 text-[var(--campus-muted)]">Los estudiantes recién registrados aparecerán temporalmente en la pantalla de proyección.</span></span>
            </label>
          </div>
        )}
      </InstitutionalDialog>
    </div>
  );
}

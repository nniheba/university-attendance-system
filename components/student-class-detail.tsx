"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { formatAttendancePercentage } from "@/lib/academic/attendance-statistics";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { StudentClassDetail, StudentSessionAttendance } from "@/lib/types";
import { academicColor } from "@/lib/academic/colors";

export function StudentClassDetailView({
  email,
  displayName,
  course,
}: {
  email: string;
  displayName: string;
  course: StudentClassDetail;
}) {
  const router = useRouter();

  async function signOut() {
    await createBrowserClient()?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader
        role="student"
        homeHref="/student"
        context="Portal del estudiante"
        identity={{ name: displayName, email, href: "/student/profile" }}
        actions={<button type="button" onClick={() => void signOut()} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Cerrar sesión</button>}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/student" }, { label: "Mis asignaturas", href: "/student#asignaturas" }, { label: course.name }]} />
        <Link href="/student" className="mt-6 inline-flex min-h-11 items-center font-semibold text-[var(--campus-blue-dark)]">← Volver a mis asignaturas</Link>
        <header id="resumen" className={`campus-panel mt-4 scroll-mt-28 border-t-4 p-5 sm:p-8 ${academicColor(course.colorKey).borderClass}`}>
          <h1 className="text-3xl font-semibold text-[var(--campus-navy)]">{course.name}</h1>
          <p className="mt-3 text-[var(--campus-muted)]">{course.groupName || "Sin grupo"}{course.academicYear ? ` · ${course.academicYear}` : ""}</p>
          <p className="mt-2 text-sm text-[var(--campus-muted)]">Profesora: {course.teacherName}</p>
        </header>
        <nav aria-label="Secciones de la asignatura" className="mt-4 flex flex-wrap gap-2"><a href="#resumen" className="inline-flex min-h-11 items-center rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Resumen</a><a href="#historial" className="inline-flex min-h-11 items-center rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Historial</a></nav>

        <section className="mt-7" aria-labelledby="class-attendance-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="class-attendance-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Asistencia</h2>
            <strong className="text-3xl font-semibold text-[var(--campus-navy)]">{formatAttendancePercentage(course.attendance.percentage)}</strong>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailStat label="Presentes" value={course.attendance.present} />
            <DetailStat label="Ausencias" value={course.attendance.absent} />
            <DetailStat label="En revisión" value={course.attendance.suspicious} tone="warning" />
            <DetailStat label="Sesiones" value={course.attendance.eligibleSessions} />
          </div>
          {course.attendance.eligibleSessions === 0 && <p className="campus-panel mt-5 px-5 py-6 text-center text-[var(--campus-muted)]">Aún no hay sesiones computables.</p>}
        </section>

        <section id="historial" className="campus-panel mt-8 scroll-mt-28 overflow-hidden" aria-labelledby="attendance-history-heading">
          <div className="border-b border-[var(--campus-border)] px-5 py-5 sm:px-7">
            <h2 id="attendance-history-heading" className="text-xl font-semibold text-[var(--campus-navy)]">Historial de sesiones</h2>
            <p className="mt-2 text-sm text-[var(--campus-muted)]">Solo se muestran sesiones cerradas y computables dentro de tus periodos de matrícula.</p>
          </div>
          {course.history.length === 0 ? (
            <p className="px-5 py-10 text-center text-[var(--campus-muted)]">Aún no hay sesiones computables.</p>
          ) : (
            <ul className="divide-y divide-[var(--campus-border)]">
              {course.history.map((row) => <HistoryRow key={row.sessionId} row={row} />)}
            </ul>
          )}
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

function DetailStat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warning" }) {
  return (
    <article className={`rounded-[5px] border px-4 py-4 ${tone === "warning" ? "border-amber-200 bg-amber-50" : "border-[var(--campus-border)] bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--campus-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--campus-navy)]">{value}</p>
    </article>
  );
}

function HistoryRow({ row }: { row: StudentSessionAttendance }) {
  const presentation = row.status === "suspicious"
    ? { label: "En revisión", classes: "bg-amber-50 text-amber-900" }
    : row.status === "present"
      ? { label: "Presente", classes: "bg-emerald-50 text-emerald-900" }
      : { label: "Ausente", classes: "bg-red-50 text-red-900" };
  return (
    <li className="flex flex-col items-stretch justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center sm:px-7">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className={`mt-1.5 size-3 shrink-0 rounded-full ${academicColor(row.colorKey).markerClass}`} />
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-[var(--campus-navy)]">{row.name}</h3>
          <time dateTime={row.openedAt} className="mt-1 block text-sm text-[var(--campus-muted)]">{formatSessionDate(row.openedAt)} · {formatSessionTime(row.openedAt)}</time>
          <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${presentation.classes}`}>{presentation.label}</span>
          {row.status === "suspicious" && <p className="mt-2 text-xs text-[var(--campus-muted)]">Este registro está pendiente de revisión por el docente.</p>}
        </div>
      </div>
      <div className="shrink-0 text-left text-sm text-[var(--campus-muted)] sm:text-right">
        {row.registeredAt && <time dateTime={row.registeredAt}>Registro: {formatSessionTime(row.registeredAt)}</time>}
        {row.origin && <p className="mt-1 font-medium text-[var(--campus-navy)]">{row.origin === "manual" ? "Manual" : "QR"}</p>}
      </div>
    </li>
  );
}

function formatSessionDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", timeZone: "Europe/Madrid" })
    .format(new Date(value))
    .replace(".", "");
}

function formatSessionTime(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(value));
}

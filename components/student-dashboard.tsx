"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { createBrowserClient } from "@/lib/supabase/browser";
import { formatAttendancePercentage } from "@/lib/academic/attendance-statistics";
import type { StudentAcademicSummary } from "@/lib/types";
import { academicColor } from "@/lib/academic/colors";

export function StudentDashboard({
  email,
  displayName,
  accountReady,
  academicSummary,
}: {
  email: string;
  displayName: string;
  accountReady: boolean;
  academicSummary: StudentAcademicSummary;
}) {
  const router = useRouter();
  const [deviceMessage, setDeviceMessage] = useState("Vinculando este navegador como dispositivo de confianza…");
  const [deviceReady, setDeviceReady] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/student/device", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { trusted?: boolean; enrolled?: boolean; code?: string };
        if (!active) return;
        if (response.ok && body.trusted) {
          setDeviceReady(true);
          setDeviceMessage(body.enrolled ? "Este navegador ya es tu dispositivo de confianza." : "Dispositivo de confianza verificado.");
        } else if (body.code === "ACCOUNT_DEVICE_MISMATCH") {
          setDeviceMessage("Esta cuenta está vinculada a otro dispositivo. Solicita un restablecimiento al profesor.");
        } else if (body.code === "DEVICE_BOUND_TO_OTHER_ACCOUNT") {
          setDeviceMessage("Este navegador ya está vinculado a otra cuenta de estudiante.");
        } else {
          setDeviceMessage("No se pudo verificar el dispositivo. Inténtalo de nuevo.");
        }
      })
      .catch(() => { if (active) setDeviceMessage("No se pudo verificar el dispositivo. Inténtalo de nuevo."); });
    return () => { active = false; };
  }, []);

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
        actions={<button type="button" onClick={() => void signOut()} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)]">Cerrar sesión</button>}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/student" }, { label: "Portal del estudiante" }]} />
        {accountReady && (
          <p role="status" className="mt-7 border-l-4 border-l-[var(--campus-success)] bg-emerald-50 px-5 py-4 leading-7 text-[var(--campus-text)]">
            <strong className="block text-[var(--campus-success)]">Tu cuenta está lista.</strong>
            Vuelve a escanear el código QR actual de la clase.
          </p>
        )}
        <section className="campus-panel mt-7 border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-9">
          <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Estudiante</p>
          <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-[var(--campus-navy)]">Hola, {displayName}</h1>
              <p className="mt-2 text-[var(--campus-muted)]">Consulta tus asignaturas y registra tu asistencia.</p>
            </div>
            <Link href="/student/scan" aria-disabled={!deviceReady} className={`campus-primary-button w-full text-center sm:w-auto sm:min-w-72 ${deviceReady ? "" : "pointer-events-none opacity-50"}`}>
              Escanear asistencia
            </Link>
          </div>
          <p role="status" className={`mt-6 border-l-4 px-4 py-3 text-sm ${deviceReady ? "border-emerald-600 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}>{deviceMessage}</p>
        </section>

        <section className="mt-8" aria-labelledby="student-summary-heading">
          <h2 id="student-summary-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Resumen</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <AcademicStat label="Asistencia global" value={formatAttendancePercentage(academicSummary.overall.percentage)} />
            <AcademicStat label="Asignaturas" value={String(academicSummary.overall.classCount)} />
            <AcademicStat label="Sesiones computables" value={String(academicSummary.overall.eligibleSessions)} />
          </div>
        </section>

        <section id="asignaturas" className="mt-10 scroll-mt-28" aria-labelledby="student-classes-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Curso actual</p>
              <h2 id="student-classes-heading" className="mt-2 text-2xl font-semibold text-[var(--campus-navy)]">Mis asignaturas</h2>
            </div>
            <Link href="/student/profile" className="inline-flex min-h-11 items-center font-semibold text-[var(--campus-blue-dark)] underline underline-offset-4">Mi perfil</Link>
          </div>
          {academicSummary.classes.length === 0 ? (
            <div className="campus-panel mt-5 px-6 py-10 text-center text-[var(--campus-muted)]">No tienes asignaturas activas todavía.</div>
          ) : (
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {academicSummary.classes.map((course) => (
                <article key={course.id} className={`campus-panel border-t-4 p-5 sm:p-6 ${academicColor(course.colorKey).borderClass}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-xl font-semibold text-[var(--campus-navy)]">{course.name}</h3>
                      <p className="mt-2 text-sm text-[var(--campus-muted)]">{course.groupName || "Sin grupo"}{course.academicYear ? ` · ${course.academicYear}` : ""}</p>
                      <p className="mt-1 text-sm text-[var(--campus-muted)]">Profesora: {course.teacherName}</p>
                    </div>
                    <span className="shrink-0 text-2xl font-semibold text-[var(--campus-blue-dark)]">{formatAttendancePercentage(course.attendance.percentage)}</span>
                  </div>
                  <p className="mt-5 text-sm text-[var(--campus-text)]"><strong>{course.attendance.present}</strong> / {course.attendance.eligibleSessions} asistencias</p>
                  {course.attendance.eligibleSessions === 0 && <p className="mt-2 text-sm text-[var(--campus-muted)]">Aún no hay sesiones computables.</p>}
                  <Link href={`/student/classes/${course.id}`} className="mt-5 inline-flex min-h-11 items-center font-semibold text-[var(--campus-blue-dark)] underline underline-offset-4">Ver historial</Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="mt-10 border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-5 py-4 text-sm text-[var(--campus-muted)]">
          <span className="font-semibold text-[var(--campus-navy)]">Cuenta institucional: </span>{email}
        </aside>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

function AcademicStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="campus-panel px-5 py-5">
      <p className="text-sm font-semibold text-[var(--campus-muted)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-[var(--campus-navy)]">{value}</p>
    </article>
  );
}

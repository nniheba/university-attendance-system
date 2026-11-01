"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AttendanceSuccessExperience } from "@/components/attendance-success-experience";
import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { submitAttendanceToken, type ScanAttendanceSuccess } from "@/lib/attendance/scan";

type Stage = "submitting" | "success" | "duplicate" | "error";

interface StudentFailure {
  title: string;
  detail: string;
}

function failureFor(code: string, message: string): StudentFailure {
  switch (code) {
    case "TOKEN_EXPIRED":
      return { title: "Este código ya expiró", detail: "Escanea nuevamente el QR de la pantalla." };
    case "INVALID_TOKEN":
      return { title: "Código no válido", detail: "Escanea el código de asistencia mostrado por el profesor." };
    case "DEVICE_ALREADY_USED":
      return { title: "Dispositivo ya utilizado", detail: "Este navegador ya registró otra cuenta en esta sesión." };
    case "ACCOUNT_DEVICE_MISMATCH":
      return { title: "Esta cuenta está vinculada a otro dispositivo", detail: "Solicita al profesor un restablecimiento de dispositivo antes de volver a intentarlo." };
    case "DEVICE_BOUND_TO_OTHER_ACCOUNT":
      return { title: "Dispositivo vinculado a otra cuenta", detail: "Este navegador no puede registrar asistencia con esta cuenta." };
    case "SESSION_CLOSED":
      return { title: "Sesión cerrada", detail: "El profesor ya cerró esta sesión de asistencia." };
    case "STUDENT_NOT_ENROLLED":
      return { title: "Matrícula no encontrada", detail: "No estás matriculado en esta asignatura." };
    case "ENROLLMENT_INACTIVE":
      return { title: "Matrícula inactiva", detail: "Pide al docente que reactive tu matrícula antes de intentarlo de nuevo." };
    default:
      return { title: "No se pudo registrar la asistencia", detail: message };
  }
}

export function StudentAttendance({
  qrToken,
  student,
}: {
  qrToken: string;
  student: { displayName: string; email: string };
}) {
  const [stage, setStage] = useState<Stage>("submitting");
  const [result, setResult] = useState<ScanAttendanceSuccess | null>(null);
  const [failure, setFailure] = useState<StudentFailure | null>(null);
  useEffect(() => {
    let active = true;
    void submitAttendanceToken(qrToken).then((response) => {
      if (!active) return;
      if (!response.ok) {
        setFailure(failureFor(response.code, response.message));
        setStage("error");
        return;
      }
      setResult(response);
      setStage(response.status === "already_registered" ? "duplicate" : "success");
      window.history.replaceState({}, "", "/student");
      if (typeof navigator.vibrate === "function") navigator.vibrate(40);
    }).catch(() => {
      if (!active) return;
      setFailure({ title: "No se pudo registrar la asistencia", detail: "Comprueba tu conexión y escanea nuevamente el código actual." });
      setStage("error");
    });
    return () => { active = false; };
  }, [qrToken]);

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader role="student" homeHref="/student" context="Asistencia" compact />
      <main className="flex flex-1 items-center justify-center px-4 py-7 sm:px-6 sm:py-10">
        <section className="campus-panel w-full max-w-lg border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-9" aria-live="polite">
          {stage === "submitting" && (
            <div className="py-12 text-center">
              <div className="mx-auto size-11 animate-spin rounded-full border-4 border-[var(--campus-blue-soft)] border-t-[var(--campus-blue-dark)] motion-reduce:animate-none" />
              <h1 className="mt-5 text-xl font-semibold text-[var(--campus-navy)]">Registrando asistencia…</h1>
              <p className="mt-2 text-sm text-[var(--campus-muted)]">Validando código, identidad y dispositivo.</p>
            </div>
          )}

          {(stage === "success" || stage === "duplicate") && result && (
            <div>
              <AttendanceSuccessExperience
                courseName={result.class.name}
                studentName={result.attendance.full_name || student.displayName}
                studentEmail={student.email}
                registeredAt={result.attendance.registered_at}
                duplicate={stage === "duplicate"}
                enrolled={result.enrolled}
                motivationalSeed={`${student.email}:${result.attendance.registered_at}`}
              />
              <Link href="/student" className="campus-primary-button mt-7 w-full">Volver al inicio</Link>
            </div>
          )}

          {stage === "error" && failure && (
            <div>
              <div className="border-l-4 border-l-[var(--campus-danger)] bg-red-50 px-5 py-4">
                <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-danger)]">No registrado</p>
                <h1 className="mt-2 text-2xl font-semibold text-[var(--campus-navy)]">{failure.title}</h1>
                <p role="alert" className="mt-3 leading-7 text-[var(--campus-muted)]">{failure.detail}</p>
              </div>
              <Link href="/student/scan" className="campus-primary-button mt-6 w-full">Escanear código actual</Link>
              <Link href="/student" className="mt-3 inline-flex min-h-11 w-full items-center justify-center font-semibold text-[var(--campus-blue-dark)]">Volver al inicio</Link>
            </div>
          )}
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

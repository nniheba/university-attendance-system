"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { mergeAttendanceRecord } from "@/lib/attendance/merge";
import { QR_CLOCK_TOLERANCE_MS, QR_TOKEN_LIFETIME_MS } from "@/lib/qr/constants";
import {
  createQrFrame,
  initialQrRotationState,
  nextQrRefreshAt,
  qrRotationReducer,
  type QrFrame,
} from "@/lib/qr/rotation";
import type { AttendanceRecord, ClassRecord, ClassSummary, SessionView } from "@/lib/types";
import { formatAttendancePercentage } from "@/lib/academic/attendance-statistics";
import { teacherAvatarPath, type TeacherAvatarKey } from "@/lib/teacher-profile";
import { InstitutionalLoader, InstitutionalMutationOverlay, PendingButtonLabel } from "@/components/institutional-loading";
import { AcademicColorPicker } from "@/components/academic-color-picker";
import { InstitutionalDialog } from "@/components/institutional-dialog";
import { academicColor, sessionDisplayName, type AcademicColorKey } from "@/lib/academic/colors";
import { madridDateTimeInput, madridLocalDateTimeToIso } from "@/lib/academic/madrid-time";
import { resetStudentAccount } from "@/lib/academic/student-account-reset";

interface TeacherIdentity {
  email: string;
  name: string;
  avatarKey: TeacherAvatarKey;
}

interface ApiError {
  message?: string;
}

type TeacherDialog =
  | { type: "close-session" }
  | { type: "edit-session"; name: string; date: string; time: string; colorKey: AcademicColorKey; enableProjectionBubbles: boolean; originalOpenedAt: string }
  | null;

const QR_RETRY_DELAY_MS = 750;

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body
      ? String((body as ApiError).message)
      : "La operación no se pudo completar.";
    throw new Error(message);
  }
  return body as T;
}

async function preloadQrImage(source: string): Promise<void> {
  const image = new window.Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la imagen del QR."));
  });
  image.src = source;
  if (typeof image.decode === "function") {
    try {
      await image.decode();
      return;
    } catch {
      // Safari can reject decode() for an otherwise loadable data URL.
    }
  }
  await loaded;
}

export function TeacherDashboard({ teacher, initialClassId = null }: { teacher: TeacherIdentity; initialClassId?: string | null }) {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState<ClassSummary | null>(null);
  const [newClassName, setNewClassName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newAcademicYear, setNewAcademicYear] = useState("");
  const [newEnrollmentMode, setNewEnrollmentMode] = useState<"closed" | "self_enroll">("closed");
  const [newClassColor, setNewClassColor] = useState<AcademicColorKey>("blue");
  const [sessionName, setSessionName] = useState("");
  const [sessionColor, setSessionColor] = useState<AcademicColorKey>("blue");
  const [allowSelfEnrollment, setAllowSelfEnrollment] = useState(false);
  const [enableProjectionBubbles, setEnableProjectionBubbles] = useState(true);
  const [useLocation, setUseLocation] = useState(false);
  const [teacherLocation, setTeacherLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [allowedRadiusM, setAllowedRadiusM] = useState("50");
  const [locationMessage, setLocationMessage] = useState("");
  const [session, setSession] = useState<SessionView | null>(null);
  const [qrState, dispatchQr] = useReducer(qrRotationReducer, initialQrRotationState);
  const [busy, setBusy] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<TeacherDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [, setLatestAttendanceId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const generatingQr = useRef(false);
  const currentQr = useRef<QrFrame | null>(null);
  const nextQrAttemptAt = useRef(0);
  const qrGeneration = useRef(0);
  const attendanceIds = useRef(new Set<string>());
  const sessionId = session?.id;
  const sessionStatus = session?.status;

  const loadClasses = useCallback(async () => {
    const response = await fetch("/api/classes", { cache: "no-store" });
    const body = await responseJson<{ classes: ClassSummary[] }>(response);
    setClasses(body.classes);
    const requestedClass = body.classes.find((item) => item.id === initialClassId) ?? null;
    if (requestedClass) {
      setSelectedClass(requestedClass);
      setAllowSelfEnrollment(requestedClass.enrollment_mode === "self_enroll");
      setSessionColor(requestedClass.color_key);
    }
  }, [initialClassId]);

  const refreshSession = useCallback(async (activeSessionId: string) => {
    const response = await fetch(`/api/sessions/${activeSessionId}`, { cache: "no-store" });
    const body = await responseJson<{ session: SessionView }>(response);
    attendanceIds.current = new Set(body.session.attendance.map((record) => record.id));
    setLatestAttendanceId(null);
    setSession(body.session);
  }, []);

  const generateQr = useCallback(async (activeSessionId: string, generation: number) => {
    if (generatingQr.current) return;
    generatingQr.current = true;
    dispatchQr({ type: "refresh-started" });
    try {
      const requestedAt = Date.now();
      const response = await fetch(`/api/sessions/${activeSessionId}/qr`, { cache: "no-store" });
      const body = await responseJson<{ value: string; expiresInMs: number }>(response);
      const { default: QRCode } = await import("qrcode");
      const imageDataUrl = await QRCode.toDataURL(body.value, {
        width: 720,
        margin: 3,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      await preloadQrImage(imageDataUrl);
      if (qrGeneration.current !== generation) return;

      const readyAt = Date.now();
      const frame = createQrFrame(
        imageDataUrl,
        requestedAt + body.expiresInMs,
        readyAt,
        QR_TOKEN_LIFETIME_MS,
        QR_CLOCK_TOLERANCE_MS,
      );
      if (frame.displayUntil <= readyAt) throw new Error("El QR preparado ya no está vigente.");
      currentQr.current = frame;
      dispatchQr({ type: "refresh-ready", frame });
      nextQrAttemptAt.current = nextQrRefreshAt(frame);
    } catch (caught) {
      if (qrGeneration.current !== generation) return;
      const warning = caught instanceof Error ? caught.message : "No se pudo renovar el QR.";
      dispatchQr({ type: "refresh-failed", warning: `${warning} Reintentando…` });
      nextQrAttemptAt.current = Date.now() + QR_RETRY_DELAY_MS;
    } finally {
      generatingQr.current = false;
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadClasses()
        .catch((caught) => setError(caught instanceof Error ? caught.message : "No se pudieron cargar las asignaturas."))
        .finally(() => setClassesLoading(false));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadClasses]);

  useEffect(() => {
    const storedSession = window.localStorage.getItem("attendance:active-session");
    if (!storedSession) return;
    const timeout = window.setTimeout(() => {
      refreshSession(storedSession).catch(() => {
        window.localStorage.removeItem("attendance:active-session");
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshSession]);

  useEffect(() => {
    if (!sessionId || sessionStatus !== "open") return;
    qrGeneration.current += 1;
    const generation = qrGeneration.current;
    currentQr.current = null;
    nextQrAttemptAt.current = 0;
    dispatchQr({ type: "reset" });

    const initial = window.setTimeout(() => void generateQr(sessionId, generation), 0);
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (!generatingQr.current && now >= nextQrAttemptAt.current) {
        void generateQr(sessionId, generation);
      }
    }, 200);
    return () => {
      qrGeneration.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [generateQr, sessionId, sessionStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const supabase = createBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    const channel = supabase
      .channel(`attendance:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as AttendanceRecord;
          if (!row?.id || row.session_id !== sessionId) return;
          attendanceIds.current.add(row.id);
          setLatestAttendanceId(row.voided_at ? null : row.id);
          setSession((current) => {
            if (!current) return current;
            const merged = mergeAttendanceRecord(current.attendance, row);
            return merged.changed ? { ...current, attendance: merged.attendance } : current;
          });
        },
      );

    void (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled || sessionError || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (!cancelled) channel.subscribe();
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  async function openAttendance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClass) return;
    setBusy(true);
    setPendingLabel("Abriendo asistencia…");
    setError("");
    try {
      const sessionResponse = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClass.id,
          sessionName,
          colorKey: sessionColor,
          useLocation,
          latitude: teacherLocation?.latitude,
          longitude: teacherLocation?.longitude,
          allowedRadiusM: Number(allowedRadiusM),
          allowSelfEnrollment,
          enableProjectionBubbles,
        }),
      });
      const sessionBody = await responseJson<{ session: Omit<SessionView, "class" | "attendance"> }>(sessionResponse);
      const nextSession: SessionView = { ...sessionBody.session, class: selectedClass, attendance: [] };
      attendanceIds.current = new Set();
      setLatestAttendanceId(null);
      setSession(nextSession);
      window.localStorage.setItem("attendance:active-session", nextSession.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir la asistencia.");
    } finally {
      setBusy(false);
      setPendingLabel(null);
    }
  }

  async function createClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPendingLabel("Creando asignatura…");
    setError("");
    try {
      const response = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newClassName, groupName: newGroupName, academicYear: newAcademicYear, enrollmentMode: newEnrollmentMode, colorKey: newClassColor }),
      });
      const body = await responseJson<{ class: ClassRecord }>(response);
      const created: ClassSummary = {
        ...body.class,
        student_count: 0,
        session_count: 0,
        closed_session_count: 0,
        average_attendance_percentage: null,
      };
      setClasses((current) => [created, ...current]);
      setNewClassName("");
      setNewGroupName("");
      setNewAcademicYear("");
      setNewEnrollmentMode("closed");
      setNewClassColor("blue");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear la asignatura.");
    } finally {
      setBusy(false);
      setPendingLabel(null);
    }
  }

  function captureTeacherLocation() {
    if (typeof navigator.geolocation?.getCurrentPosition !== "function") {
      setLocationMessage("La ubicación no está disponible en este navegador.");
      return;
    }
    setLocationMessage("Obteniendo ubicación…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setTeacherLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationMessage(`Ubicación preparada · precisión aproximada ${Math.ceil(position.coords.accuracy)} m`);
      },
      () => setLocationMessage("No se pudo obtener la ubicación. Puedes desactivar esta comprobación."),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  }

  async function addManualAttendance(email: string, reason: string) {
    if (!session) return;
    const response = await fetch(`/api/sessions/${session.id}/attendance/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, reason }),
    });
    const body = await responseJson<{ attendance: AttendanceRecord }>(response);
    setSession((current) => current
      ? { ...current, attendance: mergeAttendanceRecord(current.attendance, body.attendance).attendance }
      : current);
  }

  async function moderateAttendance(
    attendanceId: string,
    action: "mark_suspicious" | "clear_suspicious" | "update_note" | "void",
    value?: string,
  ) {
    if (!session) return;
    const response = await fetch(`/api/sessions/${session.id}/attendance/${attendanceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(action === "update_note" ? { note: value ?? "" } : { reason: value ?? "" }) }),
    });
    const body = await responseJson<{ attendance: AttendanceRecord }>(response);
    setSession((current) => current
      ? { ...current, attendance: mergeAttendanceRecord(current.attendance, body.attendance).attendance }
      : current);
  }

  async function resetStudentDevice(email: string) {
    await resetStudentAccount(email);
  }

  async function closeAttendance() {
    if (!session) return;
    setDialogBusy(true);
    setDialogError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      await responseJson(response);
      setSession({ ...session, status: "closed", closed_at: new Date().toISOString() });
      currentQr.current = null;
      dispatchQr({ type: "reset" });
      window.localStorage.removeItem("attendance:active-session");
      setDialog(null);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "No se pudo cerrar la asistencia.");
    } finally {
      setDialogBusy(false);
    }
  }

  function openActiveSessionEditor() {
    if (!session) return;
    const localDateTime = madridDateTimeInput(session.opened_at);
    if (!localDateTime) {
      setError("No se pudo interpretar la fecha de esta sesión.");
      return;
    }
    setDialogError("");
    setDialog({
      type: "edit-session",
      name: sessionDisplayName(session.session_name),
      date: localDateTime.date,
      time: localDateTime.time,
      colorKey: session.color_key,
      enableProjectionBubbles: session.enable_projection_bubbles,
      originalOpenedAt: session.opened_at,
    });
  }

  async function saveActiveSession() {
    if (!session || dialog?.type !== "edit-session") return;
    const originalLocalDateTime = madridDateTimeInput(dialog.originalOpenedAt);
    const openedAt = originalLocalDateTime?.date === dialog.date && originalLocalDateTime.time === dialog.time
      ? dialog.originalOpenedAt
      : madridLocalDateTimeToIso(dialog.date, dialog.time);
    if (!dialog.name.trim() || dialog.name.trim().length > 120) {
      setDialogError("Indica un nombre de sesión de hasta 120 caracteres.");
      return;
    }
    if (!openedAt) {
      setDialogError("La fecha y hora no son válidas en la zona horaria Europe/Madrid.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_details",
          sessionName: dialog.name,
          openedAt,
          colorKey: dialog.colorKey,
          enableProjectionBubbles: dialog.enableProjectionBubbles,
        }),
      });
      const body = await responseJson<{ session: { session_name: string; opened_at: string; color_key: AcademicColorKey; enable_projection_bubbles: boolean } }>(response);
      setSession((current) => current ? {
        ...current,
        session_name: body.session.session_name,
        opened_at: body.session.opened_at,
        color_key: body.session.color_key,
        enable_projection_bubbles: body.session.enable_projection_bubbles,
      } : current);
      setDialog(null);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "No se pudo actualizar la sesión.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function signOut() {
    const supabase = createBrowserClient();
    window.localStorage.removeItem("attendance:active-session");
    await supabase?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  if (!session) {
    return (
      <div className="campus-page flex min-h-screen flex-col">
        <InstitutionalMutationOverlay label={pendingLabel} />
        <TeacherNav teacher={teacher} onSignOut={() => void signOut()} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {selectedClass ? (
            <>
              <header>
                <Breadcrumb items={[{ label: "Inicio", href: "/teacher" }, { label: "Mis asignaturas", href: "/teacher#asignaturas" }, { label: selectedClass.name, href: `/teacher/classes/${selectedClass.id}` }, { label: "Abrir asistencia" }]} />
                <button type="button" onClick={() => setSelectedClass(null)} className="mt-6 text-sm font-semibold text-[var(--campus-blue-dark)]">← Volver a mis asignaturas</button>
                <h1 className="mt-3 text-3xl font-semibold text-[var(--campus-navy)] sm:text-4xl">Abrir asistencia</h1>
                <p className="mt-3 text-[var(--campus-muted)]">{selectedClass.name}{selectedClass.group_name ? ` · ${selectedClass.group_name}` : ""}{selectedClass.academic_year ? ` · ${selectedClass.academic_year}` : ""}</p>
              </header>
              <form onSubmit={openAttendance} className="mt-8 space-y-5">
                <FormSection number="01" title="Identidad de la sesión" description="La sesión quedará vinculada a esta asignatura y conservará su propio nombre y color.">
                  <p className="text-lg font-semibold text-[var(--campus-navy)]">{selectedClass.name}</p>
                  <p className="mt-1 text-sm text-[var(--campus-muted)]">Profesor: {teacher.name}</p>
                  <div className="mt-5">
                    <Field label="Nombre de la sesión" value={sessionName} onChange={setSessionName} placeholder="Ej. Introducción a Docker" />
                  </div>
                  <div className="mt-5">
                    <AcademicColorPicker legend="Color de la sesión" name="session-color" value={sessionColor} onChange={setSessionColor} />
                  </div>
                </FormSection>
                <FormSection number="02" title="Verificación" description="El QR temporal, la identidad institucional, la matrícula y el dispositivo protegen cada registro.">
                  <label className="flex min-h-12 items-center gap-3 text-sm font-semibold text-[var(--campus-navy)]">
                    <input type="checkbox" checked={useLocation} onChange={(event) => setUseLocation(event.target.checked)} className="size-5 accent-[var(--campus-blue)]" />
                    Usar ubicación como comprobación adicional
                  </label>
                  {useLocation && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_180px]">
                      <button type="button" onClick={captureTeacherLocation} className="campus-secondary-button">Capturar ubicación actual</button>
                      <Field label="Radio (metros)" value={allowedRadiusM} onChange={setAllowedRadiusM} placeholder="50" inputMode="numeric" />
                      {locationMessage && <p className="text-sm text-[var(--campus-muted)] sm:col-span-2">{locationMessage}</p>}
                    </div>
                  )}
                  <p className="mt-4 border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-4 py-3 text-sm text-[var(--campus-text)]">El GPS es evidencia opcional: nunca impide registrar una asistencia válida por QR.</p>
                  <fieldset className="mt-6 border-t border-[var(--campus-border)] pt-5">
                    <legend className="text-sm font-semibold text-[var(--campus-navy)]">¿Permitir que estudiantes nuevos se matriculen durante esta sesión?</legend>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <PolicyChoice label="Sí" checked={allowSelfEnrollment} onChange={() => setAllowSelfEnrollment(true)} />
                      <PolicyChoice label="No" checked={!allowSelfEnrollment} onChange={() => setAllowSelfEnrollment(false)} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--campus-muted)]">{allowSelfEnrollment ? "Los estudiantes con una cuenta institucional podrán matricularse automáticamente al registrar esta asistencia." : "Solo podrán registrar asistencia los estudiantes que ya tengan una matrícula activa."}</p>
                  </fieldset>
                  <label className="mt-6 flex items-start gap-3 border-t border-[var(--campus-border)] pt-5 text-sm text-[var(--campus-navy)]">
                    <input
                      type="checkbox"
                      checked={enableProjectionBubbles}
                      onChange={(event) => setEnableProjectionBubbles(event.target.checked)}
                      className="mt-0.5 size-5 shrink-0 accent-[var(--campus-blue)]"
                    />
                    <span>
                      <span className="block font-semibold">Animación de registros en proyección</span>
                      <span className="mt-1 block leading-6 text-[var(--campus-muted)]">Cuando esté activa, los estudiantes recién registrados aparecerán brevemente como burbujas animadas en la proyección.</span>
                    </span>
                  </label>
                </FormSection>
                <FormSection number="03" title="Resumen" description={`${selectedClass.student_count} estudiantes matriculados · ubicación adicional: ${useLocation ? "Sí" : "No"} · nuevos estudiantes: ${allowSelfEnrollment ? "Sí" : "No"} · animación: ${enableProjectionBubbles ? "Sí" : "No"}`}>
                  {error && <Alert>{error}</Alert>}
                  <button disabled={busy || !sessionName.trim() || (useLocation && !teacherLocation)} className="campus-primary-button w-full">{busy ? <PendingButtonLabel>Abriendo asistencia…</PendingButtonLabel> : "Abrir asistencia"}</button>
                </FormSection>
              </form>
            </>
          ) : (
            <>
              <header>
                <Breadcrumb items={[{ label: "Inicio", href: "/teacher" }, { label: "Mis asignaturas" }]} />
                <p className="mt-7 text-sm font-semibold text-[var(--campus-blue-dark)]">Gestión académica</p>
                <h1 className="mt-2 text-3xl font-semibold text-[var(--campus-navy)] sm:text-4xl">Mis asignaturas</h1>
                <p className="mt-3 max-w-2xl text-[var(--campus-muted)]">Crea una asignatura una sola vez, matricula a sus estudiantes y abre nuevas sesiones cuando las necesites.</p>
              </header>
              {error && <div className="mt-5"><Alert>{error}</Alert></div>}
              <details className="campus-panel mt-8 p-5 sm:p-7" open={classes.length === 0 && !classesLoading}>
                <summary className="cursor-pointer text-lg font-semibold text-[var(--campus-blue-dark)]">Nueva asignatura</summary>
                <form onSubmit={createClass} className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="Nombre" value={newClassName} onChange={setNewClassName} placeholder="Ej. Programación I" /></div>
                  <OptionalField label="Grupo (opcional)" value={newGroupName} onChange={setNewGroupName} placeholder="Ej. Grupo A" />
                  <OptionalField label="Curso académico (opcional)" value={newAcademicYear} onChange={setNewAcademicYear} placeholder="Ej. 2026–2027" />
                  <div className="sm:col-span-2"><AcademicColorPicker legend="Color de la asignatura" name="new-class-color" value={newClassColor} onChange={setNewClassColor} /></div>
                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-semibold text-[var(--campus-navy)]">¿Cómo se matricularán los estudiantes?</legend>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <PolicyCard title="Lista cerrada" description="Agregaré los estudiantes mediante su correo institucional." checked={newEnrollmentMode === "closed"} onChange={() => setNewEnrollmentMode("closed")} />
                      <PolicyCard title="Matrícula abierta" description="Los estudiantes podrán incorporarse al escanear una asistencia que permita nuevos alumnos." checked={newEnrollmentMode === "self_enroll"} onChange={() => setNewEnrollmentMode("self_enroll")} />
                    </div>
                  </fieldset>
                  <button disabled={busy || !newClassName.trim()} className="campus-primary-button sm:col-span-2">{busy ? <PendingButtonLabel>Creando asignatura…</PendingButtonLabel> : "Crear asignatura"}</button>
                </form>
              </details>
              <section id="asignaturas" className="mt-6 grid scroll-mt-28 gap-5 md:grid-cols-2" aria-label="Asignaturas activas">
                {classesLoading ? <InstitutionalLoader label="Cargando asignaturas…" /> : classes.length === 0 ? <p className="text-[var(--campus-muted)]">Todavía no hay asignaturas activas.</p> : classes.map((course) => (
                  <article key={course.id} className={`campus-panel border-t-4 p-5 sm:p-6 ${academicColor(course.color_key).borderClass}`}>
                    <h2 className="text-xl font-semibold text-[var(--campus-navy)]">{course.name}</h2>
                    <p className="mt-2 text-sm text-[var(--campus-muted)]">{course.group_name || "Sin grupo"}{course.academic_year ? ` · ${course.academic_year}` : ""}</p>
                    <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <Detail label="Estudiantes" value={String(course.student_count)} />
                      <Detail label="Sesiones computables" value={String(course.closed_session_count)} />
                      <Detail label="Asistencia media" value={formatAttendancePercentage(course.average_attendance_percentage)} />
                    </dl>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <button type="button" onClick={() => { setSelectedClass(course); setAllowSelfEnrollment(course.enrollment_mode === "self_enroll"); setEnableProjectionBubbles(true); setSessionColor(course.color_key); setSessionName(""); }} className="campus-primary-button">Abrir asistencia</button>
                      <Link href={`/teacher/classes/${course.id}`} className="campus-secondary-button">Ver asignatura</Link>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}
        </main>
        <InstitutionalFooter />
      </div>
    );
  }

  const isOpen = session.status === "open";
  const present = session.attendance.length;
  const manualAttendance = session.attendance.filter((item) => item.source === "manual").length;
  const suspiciousAttendance = session.attendance.filter((item) => item.review_status === "suspicious").length;

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalMutationOverlay label={pendingLabel} />
      <TeacherNav teacher={teacher} onSignOut={() => void signOut()} />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/teacher" }, { label: session.class.name, href: `/teacher/classes/${session.class.id}` }, { label: "Asistencia" }]} />
        <header className={`campus-panel mt-5 border-t-4 p-5 sm:p-7 ${academicColor(session.color_key).borderClass}`}>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <StatusBadge open={isOpen} />
              <dl className="mt-3 grid gap-2 text-[var(--campus-muted)]"><div><dt className="inline font-semibold text-[var(--campus-navy)]">Asignatura: </dt><dd className="inline">{session.class.name}</dd></div><div className="flex items-center gap-2"><span aria-hidden="true" className={`size-3 rounded-full ${academicColor(session.color_key).markerClass}`} /><div><dt className="inline font-semibold text-[var(--campus-navy)]">Sesión: </dt><dd className="inline text-xl font-semibold text-[var(--campus-navy)]">{sessionDisplayName(session.session_name)}</dd></div></div></dl>
              <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-2 text-sm text-[var(--campus-muted)]"><div><dt className="inline font-semibold text-[var(--campus-navy)]">Profesor: </dt><dd className="inline">{session.class.teacher_name}</dd></div><div><dt className="inline font-semibold text-[var(--campus-navy)]">Verificación: </dt><dd className="inline">QR temporal e identidad institucional</dd></div><div><dt className="inline font-semibold text-[var(--campus-navy)]">Hora de inicio: </dt><dd className="inline">{formatTime(session.opened_at)}</dd></div></dl>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={`/api/sessions/${session.id}/export`} className="campus-secondary-button">Exportar CSV</a>
              <a href={`/teacher/sessions/${session.id}/projection`} target="_blank" rel="noopener noreferrer" className="campus-primary-button">Modo proyección</a>
              {isOpen && <button onClick={openActiveSessionEditor} className="campus-secondary-button">Editar sesión</button>}
              {isOpen && <button onClick={() => { setDialogError(""); setDialog({ type: "close-session" }); }} className="campus-danger-button">Cerrar sesión</button>}
            </div>
          </div>
        </header>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen de sesión"><Stat label="Presentes" value={String(present)} /><Stat label="Asistencias manuales" value={String(manualAttendance)} /><Stat label="Marcadas para revisión" value={String(suspiciousAttendance)} tone={suspiciousAttendance ? "warning" : "default"} /><Stat label="Tiempo de sesión" value={elapsed(session.opened_at, clock)} /></section>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
          <section className="campus-panel p-5 sm:p-7">
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Código de asistencia</p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--campus-navy)]">Escanea para registrar asistencia</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--campus-muted)]">Los estudiantes deben enfocarlo con el escáner integrado. También funciona con la cámara nativa si ya iniciaron sesión.</p>
            {isOpen ? <QrSurface frame={qrState.current} size="card" /> : <div className="mt-5 grid aspect-square place-items-center rounded-[5px] bg-[var(--campus-neutral-100)] text-[var(--campus-muted)]">La sesión está cerrada.</div>}
            {qrState.warning && qrState.current && <QrWarning>{qrState.warning}</QrWarning>}
          </section>
          <AttendanceList
            session={session}
            onManual={addManualAttendance}
            onModerate={moderateAttendance}
            onResetDevice={resetStudentDevice}
          />
        </div>
      </main>
      <InstitutionalFooter />
      <InstitutionalDialog
        open={dialog !== null}
        title={dialog?.type === "edit-session" ? "Editar sesión" : "Cerrar sesión de asistencia"}
        description={dialog?.type === "edit-session"
          ? "Actualiza la identidad académica de la sesión sin interrumpir su QR."
          : <><p>Al cerrar la sesión ya no se aceptarán nuevas asistencias mediante QR.</p><p className="mt-2">Los registros realizados hasta ahora se conservarán.</p></>}
        tone={dialog?.type === "close-session" ? "danger" : "default"}
        confirmLabel={dialog?.type === "edit-session" ? "Guardar cambios" : "Cerrar sesión"}
        pendingLabel={dialog?.type === "edit-session" ? "Guardando sesión…" : "Cerrando sesión…"}
        busy={dialogBusy}
        confirmDisabled={dialog?.type === "edit-session" && !dialog.name.trim()}
        error={dialogError}
        onCancel={() => { setDialog(null); setDialogError(""); }}
        onConfirm={() => { if (dialog?.type === "edit-session") void saveActiveSession(); else void closeAttendance(); }}
      >
        {dialog?.type === "edit-session" && (
          <div className="space-y-5">
            <label className="block text-sm font-semibold text-[var(--campus-navy)]">Nombre de la sesión<input data-dialog-autofocus required maxLength={120} value={dialog.name} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-[var(--campus-navy)]">Fecha<input required type="date" value={dialog.date} onChange={(event) => setDialog({ ...dialog, date: event.target.value })} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
              <label className="text-sm font-semibold text-[var(--campus-navy)]">Hora<input required type="time" value={dialog.time} onChange={(event) => setDialog({ ...dialog, time: event.target.value })} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
            </div>
            <p className="text-xs text-[var(--campus-muted)]">Zona horaria: Europe/Madrid.</p>
            <AcademicColorPicker legend="Color de la sesión" name="active-session-edit-color" value={dialog.colorKey} onChange={(colorKey) => setDialog({ ...dialog, colorKey })} />
            <label className="flex items-start gap-3 border-t border-[var(--campus-border)] pt-5 text-sm text-[var(--campus-navy)]">
              <input type="checkbox" checked={dialog.enableProjectionBubbles} onChange={(event) => setDialog({ ...dialog, enableProjectionBubbles: event.target.checked })} className="mt-0.5 size-5 shrink-0 accent-[var(--campus-blue)]" />
              <span><span className="block font-semibold">Animación de registros en proyección</span><span className="mt-1 block leading-6 text-[var(--campus-muted)]">Los estudiantes recién registrados aparecerán temporalmente en la pantalla de proyección.</span></span>
            </label>
          </div>
        )}
      </InstitutionalDialog>
    </div>
  );
}

function QrSurface({ frame, size }: { frame: QrFrame | null; size: "card" | "projection" }) {
  const dimensions = size === "projection" ? "aspect-square w-[min(76vw,440px)] min-[800px]:w-[min(40vw,42vh,440px)] min-[1200px]:w-[min(30vw,44vh,460px)]" : "aspect-square w-full";
  return <div className={`relative mx-auto mt-5 grid place-items-center overflow-hidden border border-[var(--campus-border)] bg-white p-2 ${dimensions}`}>{frame ? <Image unoptimized priority src={frame.imageDataUrl} width={720} height={720} alt="Código QR de asistencia actual" className="h-full w-full object-contain" style={{ imageRendering: "pixelated" }} /> : <p className="text-sm font-medium text-[var(--campus-muted)]" aria-live="polite">Generando QR…</p>}</div>;
}

function AttendanceList({
  session,
  onManual,
  onModerate,
  onResetDevice,
}: {
  session: SessionView;
  onManual: (email: string, reason: string) => Promise<void>;
  onModerate: (id: string, action: "mark_suspicious" | "clear_suspicious" | "update_note" | "void", value?: string) => Promise<void>;
  onResetDevice: (email: string) => Promise<void>;
}) {
  type AttendanceDialog =
    | { type: "note"; attendance: AttendanceRecord; value: string }
    | { type: "mark-suspicious"; attendance: AttendanceRecord; value: string }
    | { type: "clear-suspicious"; attendance: AttendanceRecord }
    | { type: "void"; attendance: AttendanceRecord; value: string }
    | { type: "reset-device"; email: string }
    | null;
  const [manualEmail, setManualEmail] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AttendanceDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  async function run(action: () => Promise<void>, success: string, pending: string) {
    setActionBusy(true);
    setActionLabel(pending);
    setActionMessage("");
    try {
      await action();
      setActionMessage(success);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "No se pudo completar la operación.");
    } finally {
      setActionBusy(false);
      setActionLabel(null);
    }
  }

  async function confirmDialog() {
    if (!dialog) return;
    if (dialog.type === "void" && !dialog.value.trim()) {
      setDialogError("Indica un motivo de entre 1 y 500 caracteres.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.type === "reset-device") {
        await onResetDevice(dialog.email);
        setResetEmail("");
        setActionMessage("Dispositivo restablecido. El próximo navegador del estudiante podrá vincularse.");
      } else if (dialog.type === "note") {
        await onModerate(dialog.attendance.id, "update_note", dialog.value);
        setActionMessage("Nota actualizada.");
      } else if (dialog.type === "mark-suspicious") {
        await onModerate(dialog.attendance.id, "mark_suspicious", dialog.value);
        setActionMessage("Asistencia marcada como sospechosa.");
      } else if (dialog.type === "clear-suspicious") {
        await onModerate(dialog.attendance.id, "clear_suspicious");
        setActionMessage("Marca retirada.");
      } else {
        await onModerate(dialog.attendance.id, "void", dialog.value.trim());
        setActionMessage("Asistencia anulada.");
      }
      setDialog(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "No se pudo completar la operación.");
    } finally {
      setDialogBusy(false);
    }
  }

  function updateDialogValue(value: string) {
    setDialog((current) => current && "value" in current ? { ...current, value } : current);
  }

  return (
    <section className="campus-panel min-w-0 overflow-hidden">
      <InstitutionalMutationOverlay label={actionLabel} />
      <div className="flex items-center justify-between border-b border-[var(--campus-border)] px-5 py-5 sm:px-7">
        <h2 className="text-lg font-semibold text-[var(--campus-navy)]">Asistencias registradas</h2>
        <span className="border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-3 py-1 text-sm font-bold text-[var(--campus-blue-dark)]">Presentes: {session.attendance.length}</span>
      </div>

      {session.status === "open" && (
        <details className="border-b border-[var(--campus-border)] px-5 py-4 sm:px-7">
          <summary className="min-h-10 cursor-pointer py-2 font-semibold text-[var(--campus-blue-dark)]">Agregar asistencia manual</summary>
          <form className="mt-3 grid gap-3" onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await onManual(manualEmail, manualReason);
              setManualEmail("");
              setManualReason("");
            }, "Asistencia manual añadida.", "Agregando asistencia…");
          }}>
            <input required type="email" value={manualEmail} onChange={(event) => setManualEmail(event.target.value)} placeholder="estudiante@students.example.edu" className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-3" />
            <input required maxLength={500} value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="Motivo" className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-3" />
            <button disabled={actionBusy} className="campus-primary-button">{actionBusy ? <PendingButtonLabel>Agregando…</PendingButtonLabel> : "Añadir"}</button>
          </form>
        </details>
      )}

      <details className="border-b border-[var(--campus-border)] px-5 py-4 sm:px-7">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-[var(--campus-blue-dark)]">Restablecer dispositivo de estudiante</summary>
        <form className="mt-3 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => {
          event.preventDefault();
          setDialogError("");
          setDialog({ type: "reset-device", email: resetEmail.trim().toLowerCase() });
        }}>
          <input required type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} placeholder="estudiante@students.example.edu" className="min-h-11 flex-1 rounded-[5px] border border-[var(--campus-border)] px-3" />
          <button disabled={actionBusy} className="campus-secondary-button">{actionBusy ? <PendingButtonLabel>Restableciendo…</PendingButtonLabel> : "Restablecer"}</button>
        </form>
      </details>

      {actionMessage && <p role="status" className="border-b border-[var(--campus-border)] bg-[var(--campus-neutral-100)] px-5 py-3 text-sm text-[var(--campus-text)] sm:px-7">{actionMessage}</p>}
      {session.attendance.length === 0 ? (
        <p className="p-10 text-center text-[var(--campus-muted)]">Todavía no hay asistencias registradas.</p>
      ) : (
        <ul className="divide-y divide-[var(--campus-neutral-200)] text-sm" aria-live="polite">
          {session.attendance.map((item) => (
            <li key={item.id} className="px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="break-words font-semibold text-[var(--campus-navy)]">{item.full_name}</p>
                  <time className="mt-1 block text-[var(--campus-muted)]" dateTime={item.registered_at}>{formatTime(item.registered_at)}</time>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={item.source === "qr" ? "success" : "default"}>{item.source === "qr" ? "QR" : "Manual"}</Badge>
                  <Badge tone={item.review_status === "suspicious" ? "warning" : "default"}>{item.review_status === "suspicious" ? "Sospechosa" : "Normal"}</Badge>
                  <Badge tone={item.gps_status === "outside" || item.gps_status === "inaccurate" ? "warning" : "default"}>{gpsStatusLabel(item.gps_status)}</Badge>
                </div>
              </div>
              <details className="mt-3 text-[var(--campus-muted)]">
                <summary className="min-h-10 cursor-pointer py-2 font-medium text-[var(--campus-blue-dark)]">Detalles y acciones</summary>
                <dl className="mt-2 grid gap-4 bg-[var(--campus-neutral-100)] p-4 sm:grid-cols-2">
                  <Detail label="Origen" value={item.source === "qr" ? "Código QR" : `Manual · ${item.manual_reason ?? "Sin motivo"}`} />
                  <Detail label="GPS" value={gpsStatusLabel(item.gps_status)} />
                  <Detail label="Precisión" value={meters(item.location_accuracy)} />
                  <Detail label="Distancia" value={meters(item.distance_from_center_m)} />
                  <Detail label="Nota docente" value={item.teacher_note || "Sin nota"} />
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={actionBusy} type="button" className="min-h-10 rounded-[5px] border border-[var(--campus-border)] px-3 font-semibold" onClick={() => { setDialogError(""); setDialog({ type: "note", attendance: item, value: item.teacher_note ?? "" }); }}>Nota</button>
                  <button disabled={actionBusy} type="button" className="min-h-10 rounded-[5px] border border-amber-300 px-3 font-semibold text-amber-900" onClick={() => { setDialogError(""); setDialog(item.review_status === "suspicious" ? { type: "clear-suspicious", attendance: item } : { type: "mark-suspicious", attendance: item, value: "" }); }}>{item.review_status === "suspicious" ? "Quitar marca" : "Marcar sospechosa"}</button>
                  <button disabled={actionBusy} type="button" className="min-h-10 rounded-[5px] border border-red-300 px-3 font-semibold text-[var(--campus-danger)]" onClick={() => { setDialogError(""); setDialog({ type: "void", attendance: item, value: "" }); }}>Anular asistencia</button>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <InstitutionalDialog
        open={dialog !== null}
        title={dialog?.type === "note" ? "Nota docente" : dialog?.type === "mark-suspicious" ? "Marcar asistencia como sospechosa" : dialog?.type === "clear-suspicious" ? "Quitar marca de revisión" : dialog?.type === "void" ? "Anular asistencia" : "Restablecer dispositivo"}
        description={dialog?.type === "note"
          ? "Esta nota es privada y solo visible para el docente."
          : dialog?.type === "mark-suspicious"
            ? "El registro seguirá contando provisionalmente como asistencia mientras se revisa."
            : dialog?.type === "clear-suspicious"
              ? "El registro volverá a mostrarse como una asistencia normal."
              : dialog?.type === "void"
                ? "La asistencia dejará de contar como presente, pero se conservará en el historial de auditoría."
                : "El dispositivo actualmente vinculado dejará de ser válido. El siguiente navegador usado por el estudiante podrá vincularse."}
        tone={dialog?.type === "void" ? "danger" : dialog?.type === "mark-suspicious" ? "warning" : "default"}
        confirmLabel={dialog?.type === "note" ? "Guardar nota" : dialog?.type === "mark-suspicious" ? "Marcar como sospechosa" : dialog?.type === "clear-suspicious" ? "Quitar marca" : dialog?.type === "void" ? "Anular asistencia" : "Restablecer dispositivo"}
        pendingLabel={dialog?.type === "note" ? "Guardando nota…" : dialog?.type === "void" ? "Anulando asistencia…" : dialog?.type === "reset-device" ? "Restableciendo dispositivo…" : "Actualizando asistencia…"}
        busy={dialogBusy}
        confirmDisabled={dialog?.type === "void" && !dialog.value.trim()}
        error={dialogError}
        onCancel={() => { setDialog(null); setDialogError(""); }}
        onConfirm={() => void confirmDialog()}
      >
        {(dialog?.type === "note" || dialog?.type === "mark-suspicious" || dialog?.type === "void") && (
          <label className="block text-sm font-semibold text-[var(--campus-navy)]">
            {dialog.type === "note" ? "Nota" : dialog.type === "mark-suspicious" ? "Motivo de revisión (opcional)" : "Motivo de la anulación"}
            <textarea
              data-dialog-autofocus
              required={dialog.type === "void"}
              maxLength={500}
              rows={4}
              value={dialog.value}
              onChange={(event) => updateDialogValue(event.target.value)}
              className="mt-2 w-full rounded-[5px] border border-[var(--campus-border)] p-3 font-normal"
            />
            <span className="mt-1 block text-xs font-normal text-[var(--campus-muted)]">{dialog.value.length}/500</span>
          </label>
        )}
        {dialog?.type === "reset-device" && <p className="break-words rounded-[5px] bg-[var(--campus-neutral-100)] p-3 text-sm font-semibold text-[var(--campus-navy)]">{dialog.email}</p>}
      </InstitutionalDialog>
    </section>
  );
}

function TeacherNav({ teacher, onSignOut }: { teacher: TeacherIdentity; onSignOut: () => void }) {
  return <InstitutionalHeader role="teacher" homeHref="/teacher" identity={{ ...teacher, avatarSrc: teacherAvatarPath(teacher.avatarKey), href: "/teacher/profile" }} actions={<button onClick={onSignOut} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)]">Cerrar sesión</button>} />;
}

function PolicyChoice({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[5px] border px-4 text-sm font-semibold ${checked ? "border-[var(--campus-blue)] bg-[var(--campus-blue-soft)] text-[var(--campus-blue-dark)]" : "border-[var(--campus-border)] bg-white text-[var(--campus-navy)]"}`}><input type="radio" name="allow-self-enrollment" checked={checked} onChange={onChange} className="size-4 accent-[var(--campus-blue)]" />{label}</label>;
}

function PolicyCard({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: () => void }) {
  return <label className={`cursor-pointer rounded-[5px] border p-4 ${checked ? "border-[var(--campus-blue)] bg-[var(--campus-blue-soft)]" : "border-[var(--campus-border)] bg-white"}`}><span className="flex items-center gap-2 font-semibold text-[var(--campus-navy)]"><input type="radio" name="enrollment-mode" checked={checked} onChange={onChange} className="size-4 accent-[var(--campus-blue)]" />{title}</span><span className="mt-2 block text-sm leading-6 text-[var(--campus-muted)]">{description}</span></label>;
}

function FormSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="campus-panel p-5 sm:p-7"><div className="border-b border-[var(--campus-border)] pb-4"><p className="text-xs font-semibold text-[var(--campus-blue-dark)]">Sección {number}</p><h2 className="mt-2 text-lg font-semibold text-[var(--campus-navy)]">{title}</h2><p className="mt-1 text-sm leading-6 text-[var(--campus-muted)]">{description}</p></div><div className="mt-6">{children}</div></section>;
}

function Field({ label, value, onChange, placeholder, inputMode = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return <label className="block text-sm font-semibold text-[var(--campus-navy)]">{label}<input required value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-white px-4 font-normal text-[var(--campus-text)] placeholder:text-slate-400" /></label>;
}

function OptionalField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="block text-sm font-semibold text-[var(--campus-navy)]">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-white px-4 font-normal text-[var(--campus-text)] placeholder:text-slate-400" /></label>;
}

function StatusBadge({ open }: { open: boolean }) {
  return <span className={`inline-flex items-center gap-2 border-l-4 px-3 py-1 text-sm font-bold ${open ? "border-l-[var(--campus-success)] bg-emerald-50 text-[var(--campus-success)]" : "border-l-[var(--campus-muted)] bg-[var(--campus-neutral-100)] text-[var(--campus-muted)]"}`}><span aria-hidden="true">●</span>{open ? "Asistencia abierta" : "Asistencia cerrada"}</span>;
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return <article className={`border border-[var(--campus-border)] border-t-4 bg-white p-5 ${tone === "warning" ? "border-t-amber-500" : "border-t-[var(--campus-blue)]"}`}><p className="text-sm font-semibold text-[var(--campus-muted)]">{label}</p><p className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-[var(--campus-warning)]" : "text-[var(--campus-navy)]"}`}>{value}</p></article>;
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" | "warning" }) {
  const style = tone === "success" ? "bg-emerald-100 text-emerald-900" : tone === "warning" ? "bg-amber-100 text-amber-950" : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{children}</span>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--campus-muted)]">{label}</dt><dd className="mt-1 text-[var(--campus-text)]">{value}</dd></div>; }
function QrWarning({ children }: { children: React.ReactNode }) { return <p role="status" className="mt-3 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2 text-sm text-[var(--campus-warning)]">{children}</p>; }
function Alert({ children }: { children: React.ReactNode }) { return <p role="alert" className="border-l-4 border-l-[var(--campus-danger)] bg-red-50 px-4 py-3 text-sm font-medium text-[var(--campus-text)]">{children}</p>; }
function meters(value: number | null) { return value !== null && Number.isFinite(value) ? `${Math.ceil(value)} m` : "Desconocida"; }
function gpsStatusLabel(status: AttendanceRecord["gps_status"]) {
  if (status === "verified") return "Ubicación compatible";
  if (status === "outside") return "Ubicación fuera de zona";
  if (status === "inaccurate") return "Ubicación imprecisa";
  if (status === "shared") return "Compartida sin referencia";
  if (status === "unavailable") return "Ubicación no disponible";
  return "Ubicación no compartida";
}
function formatTime(value: string) { return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
function elapsed(openedAt: string, now: number) { const totalMinutes = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60_000)); const hours = Math.floor(totalMinutes / 60); const minutes = totalMinutes % 60; return hours ? `${hours} h ${minutes} min` : `${minutes} min`; }

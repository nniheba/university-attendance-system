"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { createBrowserClient } from "@/lib/supabase/browser";
import { teacherAvatarPath, type TeacherAvatarKey } from "@/lib/teacher-profile";
import type { ClassSummary, EnrollmentView } from "@/lib/types";
import { InstitutionalLoader, InstitutionalMutationOverlay, PendingButtonLabel } from "@/components/institutional-loading";
import { AcademicColorPicker } from "@/components/academic-color-picker";
import { InstitutionalDialog } from "@/components/institutional-dialog";
import { academicColor, type AcademicColorKey } from "@/lib/academic/colors";
import { resetStudentAccount } from "@/lib/academic/student-account-reset";

interface TeacherIdentity {
  email: string;
  name: string;
  avatarKey: TeacherAvatarKey;
}

type ClassDialog =
  | { type: "archive" }
  | { type: "deactivate-enrollment"; student: EnrollmentView }
  | { type: "reset-student-account"; student: EnrollmentView }
  | null;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "La operación no se pudo completar.");
  return body;
}

export function TeacherClassDetail({ classId, teacher }: { classId: string; teacher: TeacherIdentity }) {
  const router = useRouter();
  const [course, setCourse] = useState<ClassSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<EnrollmentView[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [enrollmentMode, setEnrollmentMode] = useState<"closed" | "self_enroll">("closed");
  const [colorKey, setColorKey] = useState<AcademicColorKey>("blue");
  const [dialog, setDialog] = useState<ClassDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const activeStudentCount = students.reduce((count, student) => count + (student.status === "active" ? 1 : 0), 0);

  const load = useCallback(async () => {
    const [classResponse, studentsResponse] = await Promise.all([
      fetch(`/api/classes/${classId}`, { cache: "no-store" }),
      fetch(`/api/classes/${classId}/students`, { cache: "no-store" }),
    ]);
    const [classBody, studentsBody] = await Promise.all([
      responseJson<{ class: ClassSummary }>(classResponse),
      responseJson<{ students: EnrollmentView[] }>(studentsResponse),
    ]);
    setCourse(classBody.class);
    setName(classBody.class.name);
    setGroupName(classBody.class.group_name ?? "");
    setAcademicYear(classBody.class.academic_year ?? "");
    setEnrollmentMode(classBody.class.enrollment_mode);
    setColorKey(classBody.class.color_key);
    setStudents(studentsBody.students);
  }, [classId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load()
        .catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo cargar la asignatura."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function addStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const response = await fetch(`/api/classes/${classId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await responseJson<{ student: EnrollmentView }>(response);
      setStudents((current) => [...current.filter((item) => item.enrollmentId !== body.student.enrollmentId), body.student]
        .sort((left, right) => left.email.localeCompare(right.email)));
      setEmail("");
    }, "Estudiante matriculado.", "Agregando estudiante…");
  }

  async function updateEnrollment(student: EnrollmentView, action: "deactivate" | "reactivate") {
    await run(async () => {
      const response = await fetch(`/api/classes/${classId}/students/${student.enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await responseJson<{ student: EnrollmentView }>(response);
      setStudents((current) => current.map((item) => item.enrollmentId === body.student.enrollmentId ? body.student : item));
    }, action === "deactivate" ? "Matrícula desactivada." : "Matrícula reactivada.", action === "deactivate" ? "Desactivando matrícula…" : "Reactivando matrícula…");
  }

  async function updateClass(action: "archive" | "restore") {
    await run(async () => {
      const response = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await responseJson<{ class: ClassSummary }>(response);
      setCourse(body.class);
    }, action === "archive" ? "Asignatura archivada." : "Asignatura restaurada.", action === "archive" ? "Archivando asignatura…" : "Restaurando asignatura…");
  }

  async function confirmDialog() {
    if (!dialog || dialogBusy) return;
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.type === "archive") {
        const response = await fetch(`/api/classes/${classId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive" }),
        });
        const body = await responseJson<{ class: ClassSummary }>(response);
        setCourse(body.class);
        setMessage("Asignatura archivada.");
      } else if (dialog.type === "deactivate-enrollment") {
        const response = await fetch(`/api/classes/${classId}/students/${dialog.student.enrollmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deactivate" }),
        });
        const body = await responseJson<{ student: EnrollmentView }>(response);
        setStudents((current) => current.map((item) => item.enrollmentId === body.student.enrollmentId ? body.student : item));
        setMessage("Matrícula desactivada.");
      } else {
        await resetStudentAccount(dialog.student.email, {
          classId,
          enrollmentId: dialog.student.enrollmentId,
        });
        setMessage("Cuenta restablecida. El estudiante podrá vincular nuevamente su navegador al iniciar sesión.");
      }
      setDialog(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "No se pudo completar la operación.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function updateDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const response = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_details", name, groupName, academicYear, enrollmentMode, colorKey }),
      });
      const body = await responseJson<{ class: ClassSummary }>(response);
      setCourse(body.class);
    }, "Detalles de la asignatura actualizados.", "Guardando cambios…");
  }

  async function run(action: () => Promise<void>, success: string, pending: string) {
    setBusy(true);
    setPendingLabel(pending);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
      setPendingLabel(null);
    }
  }

  async function signOut() {
    await createBrowserClient()?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalMutationOverlay label={pendingLabel} />
      <InstitutionalHeader role="teacher" homeHref="/teacher" identity={{ ...teacher, avatarSrc: teacherAvatarPath(teacher.avatarKey), href: "/teacher/profile" }} actions={<button onClick={() => void signOut()} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Cerrar sesión</button>} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/teacher" }, { label: "Mis asignaturas", href: "/teacher#asignaturas" }, { label: course?.name ?? "Asignatura" }]} />
        <Link href="/teacher#asignaturas" className="mt-5 inline-flex min-h-11 items-center font-semibold text-[var(--campus-blue-dark)]">← Volver a mis asignaturas</Link>
        {!course && loading ? <div className="mt-8"><InstitutionalLoader label="Cargando asignatura…" /></div> : !course ? (
          <section className="campus-panel mt-8 border-l-4 border-l-[var(--campus-danger)] p-5" role="alert">
            <h1 className="text-xl font-semibold text-[var(--campus-navy)]">No se pudo cargar la asignatura</h1>
            <p className="mt-2 text-sm text-[var(--campus-muted)]">{message || "Inténtalo de nuevo."}</p>
            <button type="button" className="campus-secondary-button mt-5" onClick={() => { setLoading(true); setMessage(""); void load().catch((error) => setMessage(error instanceof Error ? error.message : "No se pudo cargar la asignatura.")).finally(() => setLoading(false)); }}>Reintentar</button>
          </section>
        ) : (
          <>
            <header id="resumen" className={`campus-panel mt-3 scroll-mt-28 border-t-4 p-5 sm:p-7 ${academicColor(course.color_key).borderClass}`}>
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <span className="text-sm font-bold uppercase tracking-wide text-[var(--campus-blue-dark)]">{course.status === "active" ? "Activa" : "Archivada"}</span>
                  <h1 className="mt-2 text-3xl font-semibold text-[var(--campus-navy)]">{course.name}</h1>
                  <p className="mt-2 text-[var(--campus-muted)]">{course.group_name || "Sin grupo"}{course.academic_year ? ` · ${course.academic_year}` : ""}</p>
                  <p className="mt-4 text-sm text-[var(--campus-muted)]">{activeStudentCount} estudiantes · {course.session_count} sesiones</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--campus-navy)]">Matrícula: {course.enrollment_mode === "self_enroll" ? "Matrícula abierta" : "Lista cerrada"}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/teacher/classes/${course.id}/attendance`} className="campus-secondary-button">Matriz de asistencia</Link>
                  {course.status === "active" && <Link href={`/teacher?classId=${course.id}`} className="campus-primary-button">Abrir asistencia</Link>}
                  <button disabled={busy} onClick={() => { if (course.status === "active") { setDialogError(""); setDialog({ type: "archive" }); } else { void updateClass("restore"); } }} className="campus-secondary-button">{course.status === "active" ? "Archivar asignatura" : "Restaurar asignatura"}</button>
                </div>
              </div>
            </header>
            <nav aria-label="Secciones de la asignatura" className="mt-4 flex flex-wrap gap-2">
              <a href="#resumen" className="inline-flex min-h-11 items-center rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Resumen</a>
              <a href="#estudiantes" className="inline-flex min-h-11 items-center rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Estudiantes</a>
              <Link href={`/teacher/classes/${course.id}/attendance`} className="inline-flex min-h-11 items-center rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">Matriz de asistencia</Link>
            </nav>
            {message && <p role="status" className="mt-4 border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-4 py-3 text-sm">{message}</p>}
            <section className="campus-panel mt-6 p-5 sm:p-7" aria-labelledby="class-details-title">
              <h2 id="class-details-title" className="text-xl font-semibold text-[var(--campus-navy)]">Detalles y política de matrícula</h2>
              <form onSubmit={updateDetails} className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-[var(--campus-navy)] sm:col-span-2">Nombre<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
                <label className="text-sm font-semibold text-[var(--campus-navy)]">Grupo<input value={groupName} onChange={(event) => setGroupName(event.target.value)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
                <label className="text-sm font-semibold text-[var(--campus-navy)]">Curso académico<input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
                <div className="sm:col-span-2"><AcademicColorPicker legend="Color de la asignatura" name="class-color" value={colorKey} onChange={setColorKey} /></div>
                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-semibold text-[var(--campus-navy)]">Política predeterminada</legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <EnrollmentPolicyOption title="Lista cerrada" description="El docente gestiona la lista de estudiantes." checked={enrollmentMode === "closed"} onChange={() => setEnrollmentMode("closed")} />
                    <EnrollmentPolicyOption title="Matrícula abierta" description="Las nuevas sesiones propondrán permitir automatrícula por QR." checked={enrollmentMode === "self_enroll"} onChange={() => setEnrollmentMode("self_enroll")} />
                  </div>
                </fieldset>
                <button disabled={busy || course.status !== "active"} className="campus-primary-button sm:col-span-2">{busy ? <PendingButtonLabel>Guardando cambios…</PendingButtonLabel> : "Guardar cambios"}</button>
              </form>
            </section>
            <section id="estudiantes" className="campus-panel mt-6 scroll-mt-28 overflow-hidden">
              <div className="border-b border-[var(--campus-border)] p-5 sm:p-7">
                <h2 className="text-xl font-semibold text-[var(--campus-navy)]">Estudiantes</h2>
                <form onSubmit={addStudent} className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <label className="flex-1 text-sm font-semibold text-[var(--campus-navy)]">Correo institucional<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="estudiante@students.example.edu" className="mt-2 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-3 font-normal" /></label>
                  <button disabled={busy || course.status !== "active"} className="campus-primary-button self-end">{busy ? <PendingButtonLabel>Agregando estudiante…</PendingButtonLabel> : "Agregar estudiante"}</button>
                </form>
              </div>
              {students.length === 0 ? <p className="p-8 text-center text-[var(--campus-muted)]">Todavía no hay estudiantes matriculados.</p> : <ul className="divide-y divide-[var(--campus-border)]">
                {students.map((student) => <li key={student.enrollmentId} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-7">
                  <div className="min-w-0"><p className="font-semibold text-[var(--campus-navy)]">{student.displayName}</p><p className="mt-1 break-all text-sm text-[var(--campus-muted)]">{student.email}</p>{!student.registered && <p className="mt-1 text-xs font-medium text-amber-800">Cuenta aún no registrada</p>}</div>
                  <div className="flex max-w-full flex-wrap items-center justify-end gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${student.status === "active" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{student.status === "active" ? "Activo" : "Inactivo"}</span><button type="button" disabled={busy} aria-label={`Restablecer cuenta de ${student.displayName}`} onClick={() => { setDialogError(""); setDialog({ type: "reset-student-account", student }); }} className="campus-secondary-button min-h-10 px-3 text-sm">Restablecer</button><button type="button" disabled={busy} onClick={() => { if (student.status === "active") { setDialogError(""); setDialog({ type: "deactivate-enrollment", student }); } else { void updateEnrollment(student, "reactivate"); } }} className="campus-secondary-button min-h-10 px-3 text-sm">{student.status === "active" ? "Desactivar" : "Activar"}</button></div>
                </li>)}
              </ul>}
            </section>
          </>
        )}
      </main>
      <InstitutionalFooter />
      <InstitutionalDialog
        open={dialog !== null}
        title={dialog?.type === "archive" ? "Archivar asignatura" : dialog?.type === "deactivate-enrollment" ? "Desactivar matrícula" : "Restablecer cuenta del estudiante"}
        description={dialog?.type === "archive"
          ? "La asignatura dejará de aparecer entre las activas. Sus sesiones, matrículas e historial permanecerán disponibles."
          : dialog?.type === "deactivate-enrollment"
            ? `${dialog.student.displayName} dejará de participar en nuevas sesiones hasta que la matrícula sea reactivada. Su historial anterior se conservará.`
            : dialog?.type === "reset-student-account"
              ? <><p>Se restablecerá el dispositivo de confianza asociado a esta cuenta.</p><div className="mt-4 rounded-[5px] bg-[var(--campus-neutral-100)] p-4"><p className="font-semibold text-[var(--campus-navy)]">{dialog.student.displayName}</p><p className="mt-1 break-all">{dialog.student.email}</p></div><p className="mt-4">El estudiante podrá vincular nuevamente un navegador al iniciar sesión. Su cuenta, matrícula y asistencias no se eliminarán.</p></>
              : undefined}
        tone={dialog?.type === "archive" || dialog?.type === "deactivate-enrollment" ? "warning" : "default"}
        confirmLabel={dialog?.type === "archive" ? "Archivar asignatura" : dialog?.type === "deactivate-enrollment" ? "Desactivar matrícula" : "RESTABLECER CUENTA"}
        pendingLabel={dialog?.type === "archive" ? "Archivando asignatura…" : dialog?.type === "deactivate-enrollment" ? "Desactivando matrícula…" : "Restableciendo cuenta…"}
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => { setDialog(null); setDialogError(""); }}
        onConfirm={() => void confirmDialog()}
      />
    </div>
  );
}

function EnrollmentPolicyOption({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: () => void }) {
  return <label className={`cursor-pointer rounded-[5px] border p-4 ${checked ? "border-[var(--campus-blue)] bg-[var(--campus-blue-soft)]" : "border-[var(--campus-border)]"}`}><span className="flex items-center gap-2 font-semibold text-[var(--campus-navy)]"><input type="radio" name="class-enrollment-mode" checked={checked} onChange={onChange} className="size-4 accent-[var(--campus-blue)]" />{title}</span><span className="mt-2 block text-sm leading-6 text-[var(--campus-muted)]">{description}</span></label>;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { StudentAttendance } from "@/components/student-attendance";
import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { attendanceLoginUrl } from "@/lib/security/attendance-intent";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";

export const dynamic = "force-dynamic";

export default async function AttendancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    if (identity.reason === "unauthenticated") redirect(attendanceLoginUrl());
    return <InstitutionalAccessNotice nonInstitutional={identity.reason === "non_institutional"} />;
  }
  if (identity.identity.account.role !== "student") {
    return <InstitutionalAccessNotice teacher />;
  }
  const profile = await getStudentProfile(identity.identity.user.id);
  return (
    <StudentAttendance
      qrToken={token}
      student={{ displayName: profile.display_name, email: identity.identity.account.email }}
    />
  );
}

function InstitutionalAccessNotice({
  nonInstitutional = false,
  teacher = false,
}: {
  nonInstitutional?: boolean;
  teacher?: boolean;
}) {
  const href = nonInstitutional ? "/auth/sign-out?reason=institutional" : teacher ? "/teacher" : "/login";
  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader context="Asistencia" compact />
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <section className="campus-panel w-full max-w-lg border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Acceso institucional</p>
          <h1 className="mt-3 text-2xl font-semibold text-[var(--campus-navy)]">
            {teacher ? "Este código está destinado al alumnado" : "Acceso institucional requerido"}
          </h1>
          <p className="mt-4 leading-7 text-[var(--campus-muted)]">
            {teacher
              ? "Tu cuenta docente no puede registrar asistencia como estudiante."
              : "Esta aplicación requiere una cuenta institucional válida."}
          </p>
          <Link href={href} className="campus-primary-button mt-7 w-full">
            {teacher ? "Volver al panel docente" : "Iniciar sesión"}
          </Link>
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

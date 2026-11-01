import { motivationalPhraseFor } from "@/lib/content/motivational-phrases";

export function AttendanceSuccessExperience({
  courseName,
  studentName,
  studentEmail,
  registeredAt,
  duplicate,
  enrolled,
  motivationalSeed,
}: {
  courseName: string;
  studentName: string;
  studentEmail: string;
  registeredAt: string;
  duplicate: boolean;
  enrolled: boolean;
  motivationalSeed: string;
}) {
  const motivation = duplicate ? null : motivationalPhraseFor(motivationalSeed);

  return (
    <div>
      <div className={`success-ripple mx-auto ${duplicate ? "" : "success-ripple-active"}`} aria-hidden="true">
        <span className="success-ripple-ring success-ripple-ring-one" />
        <span className="success-ripple-ring success-ripple-ring-two" />
        <span className="success-ripple-ring success-ripple-ring-three" />
        <span className="scanner-success-check relative z-10 grid size-20 place-items-center rounded-full bg-emerald-100 text-4xl font-bold text-[var(--campus-success)]">✓</span>
      </div>
      <p className="mt-6 text-center text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-success)]">
        {duplicate ? "Asistencia ya registrada" : "Asistencia registrada"}
      </p>
      <h1 className="mt-2 text-center text-2xl font-semibold text-[var(--campus-navy)]">{courseName}</h1>
      {enrolled && (
        <p className="mt-4 text-center text-sm font-medium text-[var(--campus-blue-dark)]">
          Asistencia registrada. También te has matriculado en {courseName}.
        </p>
      )}
      <dl className="mt-7 divide-y divide-[var(--campus-border)] border-y border-[var(--campus-border)] text-sm">
        <Detail label="Estudiante" value={studentName} />
        <Detail label="Cuenta" value={studentEmail} />
        <Detail label="Registrada a las" value={formatAttendanceTime(registeredAt)} />
      </dl>
      {motivation && (
        <figure className="mt-6 border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-5 py-4 text-center">
          <blockquote className="text-base font-medium leading-7 text-[var(--campus-navy)]">{motivation.message}</blockquote>
          <figcaption className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--campus-blue-deep)]">
            Inspirado en {motivation.inspiration}
          </figcaption>
        </figure>
      )}
      {duplicate && <p className="mt-5 text-center text-[var(--campus-muted)]">Tu asistencia ya constaba en esta sesión.</p>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]">
      <dt className="text-[var(--campus-muted)]">{label}</dt>
      <dd className="break-words font-semibold text-[var(--campus-navy)]">{value}</dd>
    </div>
  );
}

function formatAttendanceTime(value: string): string {
  return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

import Link from "next/link";
import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";

export default function HomePage() {
  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader />
      <main className="flex-1">
        <section className="border-b border-[var(--campus-border)] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--campus-blue-dark)]">
              Proyecto universitario
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight text-[var(--campus-navy)] sm:text-5xl">
              Sistema de control de asistencia
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--campus-muted)]">
              Registro de asistencia mediante código QR temporal y verificación de presencia.
            </p>
            <Link href="/login" className="campus-primary-button mt-8">
              Acceso institucional
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="campus-panel grid gap-6 border-l-4 border-l-[var(--campus-blue)] p-6 sm:grid-cols-[180px_1fr] sm:p-8">
            <h2 className="text-lg font-semibold text-[var(--campus-navy)]">Para estudiantes</h2>
            <div>
              <p className="leading-7 text-[var(--campus-text)]">
                Escanea el código QR mostrado por el profesor para registrar tu asistencia.
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--campus-muted)]">
                Inicia sesión con tu cuenta institucional y escanea el QR de la clase. La ubicación, cuando se comparte, se usa únicamente como evidencia de presencia.
              </p>
            </div>
          </div>
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { StudentProfile } from "@/lib/student-profile";

export function StudentProfileForm({ email, initialProfile }: { email: string; initialProfile: StudentProfile }) {
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
        identity={{ name: initialProfile.display_name, email, href: "/student/profile" }}
        actions={<button type="button" onClick={() => void signOut()} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)]">Cerrar sesión</button>}
        compact
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/student" }, { label: "Perfil" }]} />
        <div className="mt-7 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--campus-border)] pb-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Cuenta de estudiante</p>
            <h1 className="mt-2 text-3xl font-semibold text-[var(--campus-navy)]">Mi perfil</h1>
          </div>
          <Link href="/student" className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 py-2.5 text-sm font-semibold text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)]">← Volver al inicio</Link>
        </div>
        <section className="campus-panel mt-6 p-5 sm:p-8" aria-labelledby="student-identity-title">
          <h2 id="student-identity-title" className="text-lg font-semibold text-[var(--campus-navy)]">Identidad institucional</h2>
          <label className="block text-sm font-semibold text-[var(--campus-navy)]">
            Nombre
            <input readOnly value={initialProfile.display_name} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-[var(--campus-neutral-100)] px-4 font-normal text-[var(--campus-muted)]" />
          </label>
          <label className="mt-5 block text-sm font-semibold text-[var(--campus-navy)]">
            Correo institucional
            <input readOnly value={email} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-[var(--campus-neutral-100)] px-4 font-normal text-[var(--campus-muted)]" />
          </label>
          <p className="mt-3 text-sm leading-6 text-[var(--campus-muted)]">El nombre y el correo se obtienen de tu cuenta institucional y no pueden modificarse.</p>
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Breadcrumb, InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  TEACHER_AVATAR_KEYS,
  teacherAvatarPath,
  type TeacherAvatarKey,
  type TeacherProfile,
} from "@/lib/teacher-profile";
import { InstitutionalMutationOverlay, PendingButtonLabel } from "@/components/institutional-loading";

interface ProfileResponse {
  profile?: TeacherProfile;
  message?: string;
}

export function TeacherProfileForm({
  email,
  initialProfile,
}: {
  email: string;
  initialProfile: TeacherProfile;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [avatarKey, setAvatarKey] = useState<TeacherAvatarKey>(initialProfile.avatar_key);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/teacher/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarKey }),
      });
      const body = await response.json() as ProfileResponse;
      if (!response.ok || !body.profile) {
        throw new Error(body.message || "No se pudo actualizar el perfil.");
      }
      setProfile(body.profile);
      setAvatarKey(body.profile.avatar_key);
      setMessage("Perfil actualizado correctamente.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar el perfil.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await createBrowserClient()?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalMutationOverlay label={busy ? "Actualizando perfil…" : null} />
      <InstitutionalHeader
        role="teacher"
        homeHref="/teacher"
        identity={{
          name: profile.display_name,
          email,
          avatarSrc: teacherAvatarPath(profile.avatar_key),
          href: "/teacher/profile",
        }}
        actions={<button type="button" onClick={() => void signOut()} className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-3 text-sm font-semibold text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)] sm:px-4"><span className="sm:hidden">Salir</span><span className="hidden sm:inline">Cerrar sesión</span></button>}
        compact
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Breadcrumb items={[{ label: "Inicio", href: "/teacher" }, { label: "Perfil" }]} />
        <div className="mt-7 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--campus-border)] pb-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Cuenta docente</p>
            <h1 className="mt-2 text-3xl font-semibold text-[var(--campus-navy)]">Perfil</h1>
          </div>
          <Link href="/teacher" className="min-h-11 rounded-[5px] border border-[var(--campus-border)] px-4 py-2.5 text-sm font-semibold text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)]">← Volver al inicio</Link>
        </div>

        <form onSubmit={saveProfile} className="campus-panel mt-6 p-5 sm:p-8">
          <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
            <section aria-labelledby="profile-photo-title">
              <h2 id="profile-photo-title" className="text-sm font-bold uppercase tracking-[0.08em] text-[var(--campus-navy)]">Foto de perfil</h2>
              <Image src={teacherAvatarPath(avatarKey)} alt={`Avatar seleccionado para ${profile.display_name}`} width={160} height={160} className="mt-4 size-36 rounded-full border border-[var(--campus-border)] bg-white" priority />
            </section>

            <div>
              <label className="block text-sm font-semibold text-[var(--campus-navy)]">
                Nombre
                <input readOnly value={profile.display_name} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-[var(--campus-neutral-100)] px-4 font-normal text-[var(--campus-muted)]" />
              </label>
              <label className="mt-5 block text-sm font-semibold text-[var(--campus-navy)]">
                Correo electrónico
                <input readOnly value={email} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-[var(--campus-neutral-100)] px-4 font-normal text-[var(--campus-muted)]" />
              </label>
            </div>
          </div>

          <fieldset className="mt-8 border-t border-[var(--campus-border)] pt-6">
            <legend className="px-2 text-sm font-bold uppercase tracking-[0.08em] text-[var(--campus-navy)]">Selecciona un avatar</legend>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {TEACHER_AVATAR_KEYS.map((key, index) => (
                <label key={key} className={`cursor-pointer rounded-[6px] border p-2 text-center ${avatarKey === key ? "border-[var(--campus-blue)] bg-[var(--campus-blue-soft)]" : "border-[var(--campus-border)] bg-white"}`}>
                  <input type="radio" name="avatar" value={key} checked={avatarKey === key} onChange={() => setAvatarKey(key)} className="sr-only" />
                  <Image src={teacherAvatarPath(key)} alt={`Avatar ${index + 1}`} width={96} height={96} className="mx-auto aspect-square w-full max-w-20 rounded-full" />
                  <span className="mt-2 block text-xs font-semibold text-[var(--campus-muted)]">Opción {index + 1}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {message && <p role="status" className="mt-6 border-l-4 border-l-[var(--campus-success)] bg-emerald-50 px-4 py-3 text-sm font-medium text-[var(--campus-success)]">{message}</p>}
          {error && <p role="alert" className="mt-6 border-l-4 border-l-[var(--campus-danger)] bg-red-50 px-4 py-3 text-sm font-medium text-[var(--campus-text)]">{error}</p>}
          <button disabled={busy} className="campus-primary-button mt-7 w-full sm:w-auto">{busy ? <PendingButtonLabel>Guardando cambios…</PendingButtonLabel> : "Guardar cambios"}</button>
        </form>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

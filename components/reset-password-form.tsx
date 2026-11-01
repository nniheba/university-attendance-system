"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { INSTITUTIONAL_PASSWORD_MIN_LENGTH } from "@/lib/security/institutional-password";
import { createBrowserClient } from "@/lib/supabase/browser";

type RecoveryState = "checking" | "valid" | "invalid" | "success";

export function ResetPasswordForm({ code, serverRecovery }: { code: string | null; serverRecovery: boolean }) {
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createBrowserClient();
    if (!supabase) {
      queueMicrotask(() => { if (active) setState("invalid"); });
      return () => { active = false; };
    }
    let recoveryEvent = false;
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) {
        recoveryEvent = true;
        setState("valid");
      }
    });
    void (async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (active) setState(error ? "invalid" : "valid");
        if (!error) window.history.replaceState({}, "", "/reset-password");
        return;
      }
      if (serverRecovery) {
        const { data } = await supabase.auth.getSession();
        if (active) setState(data.session ? "valid" : "invalid");
        return;
      }
      const recoveryHash = window.location.hash.includes("type=recovery");
      if (recoveryHash) {
        const { data } = await supabase.auth.getSession();
        if (active) setState(data.session || recoveryEvent ? "valid" : "invalid");
        return;
      }
      if (active && !recoveryEvent) setState("invalid");
    })();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [code, serverRecovery]);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < INSTITUTIONAL_PASSWORD_MIN_LENGTH) {
      setMessage("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }
    const supabase = createBrowserClient();
    if (!supabase || state !== "valid") {
      setState("invalid");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage("No se pudo actualizar la contraseña. Solicita un nuevo enlace.");
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    setState("success");
    setBusy(false);
  }

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader context="Crear nueva contraseña" />
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <section className="campus-panel w-full max-w-lg border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-9">
          <h1 className="text-3xl font-semibold text-[var(--campus-navy)]">Crear nueva contraseña</h1>
          {state === "checking" && <p className="mt-5 text-[var(--campus-muted)]">Verificando el enlace de recuperación…</p>}
          {state === "invalid" && (
            <div className="mt-5">
              <p role="alert" className="border-l-4 border-red-500 bg-red-50 px-4 py-3">El enlace de recuperación no es válido o ya expiró.</p>
              <Link href="/forgot-password" className="campus-primary-button mt-6 w-full">Solicitar nuevo enlace</Link>
            </div>
          )}
          {state === "valid" && (
            <form onSubmit={updatePassword} className="mt-7 space-y-5">
              <PasswordField label="Nueva contraseña" value={password} onChange={setPassword} />
              <PasswordField label="Confirmar contraseña" value={confirmation} onChange={setConfirmation} />
              <p className="text-xs text-[var(--campus-muted)]">Mínimo 8 caracteres.</p>
              {message && <p role="alert" className="border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm">{message}</p>}
              <button disabled={busy} className="campus-primary-button w-full">{busy ? "Actualizando…" : "Actualizar contraseña"}</button>
            </form>
          )}
          {state === "success" && (
            <div className="mt-5">
              <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3">Contraseña actualizada correctamente.</p>
              <Link href="/login" className="campus-primary-button mt-6 w-full">Iniciar sesión</Link>
            </div>
          )}
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-[var(--campus-navy)]">
      {label}
      <input type="password" autoComplete="new-password" minLength={INSTITUTIONAL_PASSWORD_MIN_LENGTH} required value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] px-4" />
    </label>
  );
}

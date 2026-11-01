"use client";

import Link from "next/link";
import { useState } from "react";

import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json() as { message?: string };
      setMessage(body.message || "No se pudo completar la solicitud.");
      setError(!response.ok);
    } catch {
      setMessage("No se pudo conectar con el servidor.");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader context="Recuperar contraseña" />
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <section className="campus-panel w-full max-w-lg border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-9">
          <h1 className="text-3xl font-semibold text-[var(--campus-navy)]">Recuperar contraseña</h1>
          <p className="mt-3 leading-7 text-[var(--campus-muted)]">Introduce tu correo institucional y te enviaremos un enlace para crear una nueva contraseña.</p>
          <form onSubmit={submit} className="mt-7 space-y-5">
            <label className="block text-sm font-semibold text-[var(--campus-navy)]">
              Correo institucional
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] px-4" />
            </label>
            {message && <p role={error ? "alert" : "status"} className={`border-l-4 px-4 py-3 text-sm leading-6 ${error ? "border-red-500 bg-red-50" : "border-emerald-600 bg-emerald-50"}`}>{message}</p>}
            <button disabled={busy} className="campus-primary-button w-full">{busy ? "Enviando…" : "Enviar enlace de recuperación"}</button>
          </form>
          <Link href="/login" className="mt-4 inline-flex min-h-11 w-full items-center justify-center font-semibold text-[var(--campus-blue-dark)]">Volver al inicio de sesión</Link>
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

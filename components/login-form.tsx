"use client";

import Link from "next/link";
import { useState } from "react";
import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import {
  INSTITUTIONAL_PASSWORD_MIN_LENGTH,
  institutionalPasswordsMatch,
} from "@/lib/security/institutional-password";

type AuthMode = "sign-in" | "sign-up";

interface ApiPayload {
  message?: string;
  destination?: string;
  role?: "student" | "teacher";
}

async function postJson(path: string, body: Record<string, string>): Promise<ApiPayload> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as ApiPayload;
  if (!response.ok) throw new Error(payload.message || "No se pudo completar la operación.");
  return payload;
}

export function LoginForm({
  institutionalOnly = false,
  teacherAccessDenied = false,
  bootstrapFailure = false,
  attendanceIntent = null,
}: {
  institutionalOnly?: boolean;
  teacherAccessDenied?: boolean;
  bootstrapFailure?: boolean;
  attendanceIntent?: string | null;
}) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "sign-up" && !institutionalPasswordsMatch(password, passwordConfirmation)) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const endpoint = mode === "sign-in" ? "/api/auth/sign-in" : "/api/auth/sign-up";
      const result = await postJson(endpoint, { email, password });
      const destination = result.role === "student" && attendanceIntent
        ? attendanceIntent
        : result.destination || "/student";
      window.location.assign(destination);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "No se pudo completar la operación.");
      setBusy(false);
    }
  }

  function selectMode(nextMode: AuthMode) {
    if (busy) return;
    setMode(nextMode);
    setMessage("");
    setPassword("");
    setPasswordConfirmation("");
  }

  return (
    <div className="campus-page flex min-h-screen flex-col">
      <InstitutionalHeader context="Acceso institucional" />
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <section className="campus-panel w-full max-w-lg border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-9">
          <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Acceso institucional</p>
          <h1 className="mt-3 text-3xl font-semibold text-[var(--campus-navy)]">Sistema de control de asistencia</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--campus-muted)]">Usa el correo institucional configurado para tu centro.</p>
          <p className="mt-2 text-xs leading-5 text-[var(--campus-muted)]">La distribución pública utiliza dominios de ejemplo reservados.</p>

          {attendanceIntent && (
            <p className="mt-5 border-l-4 border-l-[var(--campus-blue)] bg-[var(--campus-blue-soft)] px-4 py-3 text-sm leading-6 text-[var(--campus-navy)]">
              Inicia sesión o crea tu cuenta. Después volverás al escáner para leer el código vigente de la clase.
            </p>
          )}

          <div className="mt-7 grid grid-cols-2 border-b border-[var(--campus-border)]" role="group" aria-label="Tipo de acceso">
            <ModeButton active={mode === "sign-in"} onClick={() => selectMode("sign-in")}>Iniciar sesión</ModeButton>
            <ModeButton active={mode === "sign-up"} onClick={() => selectMode("sign-up")}>Crear cuenta</ModeButton>
          </div>

          {institutionalOnly && <Notice>Esta aplicación solo admite los dominios institucionales configurados.</Notice>}
          {teacherAccessDenied && <Notice>Tu cuenta institucional no tiene acceso docente autorizado.</Notice>}
          {bootstrapFailure && <Notice>No pudimos preparar tu cuenta institucional. Inténtalo más tarde.</Notice>}

          <form className="mt-7 space-y-5" onSubmit={authenticate}>
            <label className="block text-sm font-semibold text-[var(--campus-navy)]">
              Correo institucional
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nombre.apellido@students.example.edu"
                className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-white px-4 text-[var(--campus-text)]"
              />
            </label>
            {mode === "sign-in" && (
              <div className="-mt-3 text-right">
                <Link href="/forgot-password" className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--campus-blue-dark)] hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            )}
            <label className="block text-sm font-semibold text-[var(--campus-navy)]">
              Contraseña
              <input
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={INSTITUTIONAL_PASSWORD_MIN_LENGTH}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-white px-4 text-[var(--campus-text)]"
              />
            </label>
            {mode === "sign-up" && (
              <label className="block text-sm font-semibold text-[var(--campus-navy)]">
                Confirmar contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={INSTITUTIONAL_PASSWORD_MIN_LENGTH}
                  required
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-[5px] border border-[var(--campus-border)] bg-white px-4 text-[var(--campus-text)]"
                />
              </label>
            )}
            <p className="text-xs leading-5 text-[var(--campus-muted)]">La contraseña debe tener al menos 8 caracteres.</p>
            {message && <Notice>{message}</Notice>}
            <button disabled={busy} className="campus-primary-button w-full">
              {busy ? "Procesando…" : mode === "sign-in" ? "Iniciar sesión" : "Crear cuenta"}
            </button>
          </form>
        </section>
      </main>
      <InstitutionalFooter />
    </div>
  );
}

function ModeButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-12 border-b-2 px-3 text-sm font-bold ${active ? "border-[var(--campus-blue)] text-[var(--campus-blue-dark)]" : "border-transparent text-[var(--campus-muted)]"}`}
    >
      {children}
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mt-5 border-l-4 border-l-[var(--campus-danger)] bg-red-50 px-4 py-3 text-sm leading-6 text-[var(--campus-text)]">{children}</p>;
}

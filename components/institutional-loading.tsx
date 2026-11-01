interface InstitutionalLoaderProps {
  label?: string;
  compact?: boolean;
}

export function InstitutionalLoader({ label = "Cargando…", compact = false }: InstitutionalLoaderProps) {
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center justify-center gap-2 text-[var(--campus-muted)] ${compact ? "text-sm" : "min-h-12"}`}>
      <span className="campus-spinner text-[var(--campus-blue-dark)]" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function PendingButtonLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-2" role="status" aria-live="polite">
      <span className="campus-spinner" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export function InstitutionalMutationOverlay({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/20 p-4" aria-busy="true">
      <div className="campus-panel flex min-w-56 items-center gap-3 px-5 py-4 shadow-lg" role="status" aria-live="polite">
        <span className="campus-spinner text-[var(--campus-blue-dark)]" aria-hidden="true" />
        <span className="font-semibold text-[var(--campus-navy)]">{label}</span>
      </div>
    </div>
  );
}

export function InstitutionalRouteSkeleton({ context = "Cargando contenido…" }: { context?: string }) {
  return (
    <div className="campus-page min-h-screen bg-[var(--background)]" role="status" aria-live="polite" aria-busy="true">
      <div className="h-[82px] border-b-2 border-[var(--campus-blue-dark)] bg-white" />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <span className="sr-only">{context}</span>
        <div className="campus-skeleton h-4 w-48 rounded" />
        <div className="mt-8 grid gap-5">
          <div className="campus-panel p-6 sm:p-8">
            <div className="campus-skeleton h-4 w-28 rounded" />
            <div className="campus-skeleton mt-4 h-9 max-w-xl rounded" />
            <div className="campus-skeleton mt-4 h-4 max-w-2xl rounded" />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="campus-skeleton h-48 rounded-[4px]" />
            <div className="campus-skeleton h-48 rounded-[4px]" />
          </div>
        </div>
      </main>
    </div>
  );
}

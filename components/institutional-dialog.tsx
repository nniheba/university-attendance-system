"use client";

import { useEffect, useEffectEvent, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PendingButtonLabel } from "@/components/institutional-loading";

type DialogTone = "default" | "warning" | "danger";

interface InstitutionalDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  tone?: DialogTone;
  confirmLabel?: string;
  pendingLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  onConfirm?: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function InstitutionalDialog({
  open,
  title,
  description,
  tone = "default",
  confirmLabel = "Confirmar",
  pendingLabel = "Guardando…",
  cancelLabel = "Cancelar",
  busy = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
  children,
  footer,
}: InstitutionalDialogProps) {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const cancelDialog = useEffectEvent(() => {
    if (busy) return false;
    onCancel();
    return true;
  });

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const preferred = panelRef.current?.querySelector<HTMLElement>("[data-dialog-autofocus]");
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (preferred ?? first ?? panelRef.current)?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (cancelDialog()) event.preventDefault();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!mounted || !open) return null;

  const accent = tone === "danger"
    ? "border-t-[var(--campus-danger)]"
    : tone === "warning"
      ? "border-t-amber-500"
      : "border-t-[var(--campus-blue)]";
  const confirmClass = tone === "danger" ? "campus-danger-button" : "campus-primary-button";

  return createPortal(
    <div
      className="campus-dialog-backdrop fixed inset-0 z-[80] flex items-end justify-center bg-black/35 p-3 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy}
        tabIndex={-1}
        className={`campus-dialog-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-[7px] border border-[var(--campus-border)] border-t-4 bg-white shadow-2xl ${accent}`}
      >
        <header className="border-b border-[var(--campus-border)] px-5 py-5 sm:px-6">
          <h2 id={titleId} className="text-xl font-semibold text-[var(--campus-navy)]">{title}</h2>
          {description && <div id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--campus-muted)]">{description}</div>}
        </header>
        {children && <div className="px-5 py-5 sm:px-6">{children}</div>}
        {error && <p role="alert" className="mx-5 mb-4 border-l-4 border-l-[var(--campus-danger)] bg-red-50 px-4 py-3 text-sm text-[var(--campus-text)] sm:mx-6">{error}</p>}
        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--campus-border)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          {footer ?? (
            <>
              <button type="button" disabled={busy} onClick={onCancel} className="campus-secondary-button">{cancelLabel}</button>
              <button
                type="button"
                disabled={busy || confirmDisabled}
                onClick={onConfirm}
                className={confirmClass}
                data-dialog-autofocus={tone === "default" ? "true" : undefined}
              >
                {busy ? <PendingButtonLabel>{pendingLabel}</PendingButtonLabel> : confirmLabel}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

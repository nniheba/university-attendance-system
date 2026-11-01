"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { memo, useCallback, useEffect, useReducer, useRef, useState } from "react";

import { InstitutionalHeader } from "@/components/institutional-shell";
import { ProjectionAttendanceBubbles } from "@/components/projection-attendance-bubbles";
import { ProjectionAttendanceList } from "@/components/projection-attendance-list";
import { mergeAttendanceRecord } from "@/lib/attendance/merge";
import {
  createProjectionAttendanceBubble,
  enqueueProjectionAttendanceBubble,
  PROJECTION_BUBBLE_DURATION_MS,
  type ProjectionAttendanceBubble,
} from "@/lib/projection/attendance-bubbles";
import { QR_CLOCK_TOLERANCE_MS, QR_TOKEN_LIFETIME_MS } from "@/lib/qr/constants";
import {
  createQrFrame,
  initialQrRotationState,
  nextQrRefreshAt,
  qrRotationReducer,
  type QrFrame,
} from "@/lib/qr/rotation";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { AttendanceRecord, SessionView } from "@/lib/types";
import { academicColor, sessionDisplayName } from "@/lib/academic/colors";

const QR_RETRY_DELAY_MS = 750;

async function preloadQrImage(source: string): Promise<void> {
  const image = new window.Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo preparar la imagen del QR."));
  });
  image.src = source;
  if (typeof image.decode === "function") {
    try {
      await image.decode();
      return;
    } catch {
      // Safari can reject decode() for an otherwise loadable data URL.
    }
  }
  await loaded;
}

export function TeacherProjection({ initialSession }: { initialSession: SessionView }) {
  const [session, setSession] = useState(initialSession);
  const [recentAttendanceIds, setRecentAttendanceIds] = useState<string[]>([]);
  const [attendanceBubbles, setAttendanceBubbles] = useState<ProjectionAttendanceBubble[]>([]);
  const [qrState, dispatchQr] = useReducer(qrRotationReducer, initialQrRotationState);
  const generatingQr = useRef(false);
  const nextQrAttemptAt = useRef(0);
  const qrGeneration = useRef(0);
  const attendanceAnimationTimers = useRef(new Map<string, number>());
  const attendanceBubbleTimers = useRef(new Map<string, number>());
  const seenBubbleAttendanceIds = useRef(new Set(initialSession.attendance.map((row) => row.id)));
  const bubbleSequence = useRef(0);
  const projectionBubblesEnabled = useRef(
    initialSession.status === "open" && initialSession.enable_projection_bubbles,
  );

  const animateAttendance = useCallback((attendanceId: string) => {
    const currentTimer = attendanceAnimationTimers.current.get(attendanceId);
    if (currentTimer) window.clearTimeout(currentTimer);
    setRecentAttendanceIds((current) => [
      ...current.filter((id) => id !== attendanceId),
      attendanceId,
    ].slice(-8));
    const timer = window.setTimeout(() => {
      attendanceAnimationTimers.current.delete(attendanceId);
      setRecentAttendanceIds((current) => current.filter((id) => id !== attendanceId));
    }, 1_800);
    attendanceAnimationTimers.current.set(attendanceId, timer);
  }, []);

  const showAttendanceBubble = useCallback((attendance: AttendanceRecord) => {
    if (seenBubbleAttendanceIds.current.has(attendance.id)) return;
    seenBubbleAttendanceIds.current.add(attendance.id);
    if (!projectionBubblesEnabled.current || attendance.voided_at) return;

    const bubble = createProjectionAttendanceBubble(attendance, bubbleSequence.current);
    bubbleSequence.current += 1;
    setAttendanceBubbles((current) => enqueueProjectionAttendanceBubble(current, bubble));
    const timer = window.setTimeout(() => {
      attendanceBubbleTimers.current.delete(attendance.id);
      setAttendanceBubbles((current) => current.filter((item) => item.id !== attendance.id));
    }, PROJECTION_BUBBLE_DURATION_MS);
    attendanceBubbleTimers.current.set(attendance.id, timer);
  }, []);

  useEffect(() => {
    projectionBubblesEnabled.current =
      session.status === "open" && session.enable_projection_bubbles;
  }, [session.enable_projection_bubbles, session.status]);

  useEffect(() => () => {
    for (const timer of attendanceAnimationTimers.current.values()) window.clearTimeout(timer);
    attendanceAnimationTimers.current.clear();
    for (const timer of attendanceBubbleTimers.current.values()) window.clearTimeout(timer);
    attendanceBubbleTimers.current.clear();
  }, []);

  const generateQr = useCallback(async (generation: number) => {
    if (generatingQr.current) return;
    generatingQr.current = true;
    dispatchQr({ type: "refresh-started" });
    try {
      const requestedAt = Date.now();
      const response = await fetch(`/api/sessions/${session.id}/qr`, { cache: "no-store" });
      const body = await response.json() as { value?: string; expiresInMs?: number; message?: string };
      if (!response.ok || !body.value || !body.expiresInMs) {
        throw new Error(body.message || "No se pudo renovar el QR.");
      }
      const imageDataUrl = await QRCode.toDataURL(body.value, {
        width: 720,
        margin: 3,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      await preloadQrImage(imageDataUrl);
      if (qrGeneration.current !== generation) return;
      const readyAt = Date.now();
      const frame = createQrFrame(
        imageDataUrl,
        requestedAt + body.expiresInMs,
        readyAt,
        QR_TOKEN_LIFETIME_MS,
        QR_CLOCK_TOLERANCE_MS,
      );
      if (frame.displayUntil <= readyAt) throw new Error("El QR preparado ya no está vigente.");
      dispatchQr({ type: "refresh-ready", frame });
      nextQrAttemptAt.current = nextQrRefreshAt(frame);
    } catch (error) {
      if (qrGeneration.current !== generation) return;
      dispatchQr({
        type: "refresh-failed",
        warning: `${error instanceof Error ? error.message : "No se pudo renovar el QR."} Reintentando…`,
      });
      nextQrAttemptAt.current = Date.now() + QR_RETRY_DELAY_MS;
    } finally {
      generatingQr.current = false;
    }
  }, [session.id]);

  useEffect(() => {
    if (session.status !== "open") {
      qrGeneration.current += 1;
      dispatchQr({ type: "reset" });
      return;
    }
    qrGeneration.current += 1;
    const generation = qrGeneration.current;
    nextQrAttemptAt.current = 0;
    dispatchQr({ type: "reset" });
    const initial = window.setTimeout(() => void generateQr(generation), 0);
    const interval = window.setInterval(() => {
      if (!generatingQr.current && Date.now() >= nextQrAttemptAt.current) {
        void generateQr(generation);
      }
    }, 200);
    return () => {
      qrGeneration.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [generateQr, session.status]);

  useEffect(() => {
    const supabase = createBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    const channel = supabase.channel(`projection-attendance:${session.id}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "attendance", filter: `session_id=eq.${session.id}` },
      (payload) => {
        const row = payload.new as AttendanceRecord;
        if (!row?.id || row.session_id !== session.id) return;
        if (payload.eventType === "INSERT" && !row.voided_at) {
          animateAttendance(row.id);
          showAttendanceBubble(row);
        }
        setSession((current) => ({
          ...current,
          attendance: mergeAttendanceRecord(current.attendance, row).attendance,
        }));
      },
    );
    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled || error || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (!cancelled) channel.subscribe();
    })();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [animateAttendance, session.id, showAttendanceBubble]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetch(`/api/sessions/${session.id}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const body = await response.json() as { session: SessionView };
          setSession(body.session);
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [session.id]);

  return (
    <div className="flex min-h-dvh flex-col bg-white lg:h-dvh lg:overflow-hidden" aria-label="Modo proyección">
      <InstitutionalHeader context="Asistencia · Modo proyección" homeLink={false} compact />
      <main className="mx-auto grid min-h-0 w-full max-w-[1800px] flex-1 gap-5 overflow-y-auto px-4 py-5 sm:px-5 lg:grid-cols-[minmax(480px,1.25fr)_minmax(360px,0.75fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-3 lg:overflow-hidden lg:py-3">
        <header className="col-span-full flex flex-wrap items-end justify-between gap-4 border-b-2 border-b-[var(--campus-blue)] pb-4 lg:pb-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--campus-blue-dark)]">Campus Attendance · Sistema de Asistencia</p>
            <h1 className="mt-1 text-3xl font-semibold text-[var(--campus-navy)]">{session.class.name}</h1>
            <p className="mt-2 flex items-center gap-2 text-lg font-medium text-[var(--campus-muted)]"><span aria-hidden="true" className={`size-3 rounded-full ${academicColor(session.color_key).markerClass}`} />{sessionDisplayName(session.session_name)}</p>
          </div>
          <div className="flex items-center gap-5">
            <span className={`border-l-4 px-3 py-1 font-bold ${session.status === "open" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-500 bg-slate-100 text-slate-700"}`}>
              {session.status === "open" ? "Asistencia abierta" : "Sesión cerrada"}
            </span>
            <span className="text-2xl font-semibold tabular-nums text-[var(--campus-blue-dark)]">Presentes: {session.attendance.length}</span>
          </div>
        </header>
        <section className="flex min-h-[480px] min-w-0 flex-col items-center justify-center border-2 border-[var(--campus-blue)] bg-white p-5 text-center sm:p-7 lg:min-h-0 lg:p-4 xl:p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--campus-blue-dark)]">Registra tu asistencia</p>
          <p className="mt-2 text-xl font-semibold text-[var(--campus-navy)] sm:text-2xl">Escanéalo con la cámara de tu móvil</p>
          {session.status === "open" ? (
            <ProjectionQr frame={qrState.current} />
          ) : (
            <ProjectionClosed />
          )}
          {qrState.warning && qrState.current && <p className="mt-3 text-sm text-amber-800">{qrState.warning}</p>}
          <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--campus-muted)] lg:mt-3">¿Ya estás dentro de la plataforma? También puedes usar «Escanear asistencia».</p>
        </section>
        <div className="relative min-h-[320px] min-w-0 overflow-hidden min-[900px]:min-h-0">
          <ProjectionAttendanceList attendance={session.attendance} recentAttendanceIds={recentAttendanceIds} />
          <ProjectionAttendanceBubbles bubbles={attendanceBubbles} />
        </div>
      </main>
    </div>
  );
}

const ProjectionQr = memo(function ProjectionQr({ frame }: { frame: QrFrame | null }) {
  return (
    <ProjectionQrSurface>
      {frame ? (
        <Image unoptimized priority src={frame.imageDataUrl} width={720} height={720} alt="Código QR de asistencia actual" className="block size-full object-contain" style={{ imageRendering: "pixelated" }} />
      ) : (
        <p className="text-sm font-medium text-[var(--campus-muted)]">Generando QR…</p>
      )}
    </ProjectionQrSurface>
  );
});

const ProjectionClosed = memo(function ProjectionClosed() {
  return (
    <ProjectionQrSurface>
      <p className="text-xl font-semibold text-slate-600">Sesión cerrada</p>
    </ProjectionQrSurface>
  );
});

function ProjectionQrSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto mt-5 grid aspect-square w-[min(84vw,620px)] max-w-full shrink-0 place-items-center overflow-visible border border-[var(--campus-border)] bg-white p-2 lg:mt-3 lg:w-[min(52vw,calc(100dvh-24rem),620px)]">
      {children}
    </div>
  );
}

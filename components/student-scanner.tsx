"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

import { AttendanceSuccessExperience } from "@/components/attendance-success-experience";
import { InstitutionalFooter, InstitutionalHeader } from "@/components/institutional-shell";
import { PendingButtonLabel } from "@/components/institutional-loading";
import {
  createAttendanceScannerController,
  type AttendanceScannerController,
  type ScannerPipelineEvent,
  type ScannerPhase,
} from "@/lib/attendance/scanner-controller";
import {
  extractAttendanceToken,
  submitAttendanceToken,
  type OptionalScanLocation,
  type ScanAttendanceSuccess,
} from "@/lib/attendance/scan";
import { attendanceQrTrustedOrigins } from "@/lib/qr/attendance-value";
import { prepareScannerCamera } from "@/lib/attendance/scanner-camera";
import {
  acquireScannerCameraStream,
  CAMERA_TRANSIENT_RETRY_DELAYS_MS,
  classifyCameraFailure,
  releaseScannerVideo,
  requestScannerCameraFromUserGesture,
  stopCameraStream,
} from "@/lib/attendance/scanner-camera-recovery";
import {
  applyPreferredCameraZoom,
  DIGITAL_ZOOM_RANGE,
  digitalPreviewScale,
  normalizeScannerZoom,
  scannerRegion,
  scannerZoomRange,
  type ScannerZoomLevel,
  type ScannerZoomMode,
  type ScannerZoomRange,
} from "@/lib/attendance/scanner-zoom";
import {
  createDelayedDecoderFallback,
  type FallbackDecoderState,
} from "@/lib/attendance/zxing-fallback";

interface ScannerDiagnostics {
  framesAttempted: number;
  decodeSuccesses: number;
  decodeMisses: number;
  width: number | null;
  height: number | null;
  facingMode: string | null;
  deviceIdPresent: boolean;
  cameraLabel: string | null;
  continuousFocus: boolean;
  scannerActive: boolean;
  barcodeDetector: boolean;
  fallbackState: FallbackDecoderState;
  decoderSource: "qr-scanner" | "zxing" | null;
  qrDetected: boolean;
  detectedType: "Asistencia" | "Desconocido" | null;
  tokenParsed: boolean;
  sessionIdentified: boolean;
  classIdentified: boolean;
  className: string | null;
  apiRequest: "No enviada" | "Pendiente" | "Correcta" | "Error";
  zoomRange: ScannerZoomRange;
  cameraActivationState: CameraActivationState;
  cameraPermission: CameraPermissionState;
  userGestureStarted: boolean;
  lastCameraError: string | null;
  lastEvent: string;
}

type DeviceState = "checking" | "trusted" | "account_mismatch" | "bound_elsewhere" | "error";
type LocationState = "idle" | "requesting" | "available" | "denied" | "timeout" | "unavailable";
type CameraActivationState = "idle" | "requesting" | "active" | "paused" | "denied" | "blocked" | "busy" | "unavailable" | "error";
type CameraPermissionState = PermissionState | "unsupported" | "unknown";

function initialDiagnostics(): ScannerDiagnostics {
  return {
    framesAttempted: 0,
    decodeSuccesses: 0,
    decodeMisses: 0,
    width: null,
    height: null,
    facingMode: null,
    deviceIdPresent: false,
    cameraLabel: null,
    continuousFocus: false,
    scannerActive: false,
    barcodeDetector: false,
    fallbackState: "idle",
    decoderSource: null,
    qrDetected: false,
    detectedType: null,
    tokenParsed: false,
    sessionIdentified: false,
    classIdentified: false,
    className: null,
    apiRequest: "No enviada",
    zoomRange: DIGITAL_ZOOM_RANGE,
    cameraActivationState: "idle",
    cameraPermission: "unknown",
    userGestureStarted: false,
    lastCameraError: null,
    lastEvent: "Sin QR",
  };
}

export function StudentScanner({
  displayName,
  email,
  debug = false,
  attendanceIntent = false,
}: {
  displayName: string;
  email: string;
  debug?: boolean;
  attendanceIntent?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const scanRegionRef = useRef(scannerRegion(1, 1, 1, "unknown"));
  const scanRegionModeRef = useRef<"normal" | "recovery">("normal");
  const zoomRef = useRef<ScannerZoomLevel>(1);
  const zoomModeRef = useRef<ScannerZoomMode>("unknown");
  const zoomRangeRef = useRef<ScannerZoomRange>(DIGITAL_ZOOM_RANGE);
  const zoomRequestRef = useRef(0);
  const diagnosticsRef = useRef<ScannerDiagnostics>(initialDiagnostics());
  const locationRef = useRef<OptionalScanLocation | null>(null);
  const cameraRequestRef = useRef<Promise<MediaStream> | null>(null);
  const releaseCameraRef = useRef<(() => void) | null>(null);
  const cameraPermissionRef = useRef<CameraPermissionState>("unknown");

  const [phase, setPhaseState] = useState<ScannerPhase>("starting");
  const [message, setMessage] = useState(
    attendanceIntent
      ? "Tu cuenta está lista. Activa la cámara y vuelve a escanear el código QR que aparece en la pantalla del aula."
      : "Pulsa Activar cámara para empezar a escanear.",
  );
  const [result, setResult] = useState<ScanAttendanceSuccess | null>(null);
  const [zoom, setZoom] = useState<ScannerZoomLevel>(1);
  const [zoomMode, setZoomMode] = useState<ScannerZoomMode>("unknown");
  const [zoomRange, setZoomRange] = useState<ScannerZoomRange>(DIGITAL_ZOOM_RANGE);
  const [diagnostics, setDiagnostics] = useState<ScannerDiagnostics>(initialDiagnostics);
  const [rawQrDetected, setRawQrDetected] = useState(false);
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [cameraActivation, setCameraActivation] = useState<CameraActivationState>("idle");
  const [cameraPermission, setCameraPermission] = useState<CameraPermissionState>("unknown");
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const [locationState, setLocationState] = useState<LocationState>("idle");

  useEffect(() => {
    let active = true;
    void fetch("/api/student/device", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { trusted?: boolean; code?: string };
        if (!active) return;
        if (response.ok && body.trusted) setDeviceState("trusted");
        else if (body.code === "ACCOUNT_DEVICE_MISMATCH") setDeviceState("account_mismatch");
        else if (body.code === "DEVICE_BOUND_TO_OTHER_ACCOUNT") setDeviceState("bound_elsewhere");
        else setDeviceState("error");
      })
      .catch(() => { if (active) setDeviceState("error"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (deviceState !== "trusted" || cameraActivation !== "active") return;
    queueMicrotask(() => setLocationState("requesting"));
    if (typeof navigator.geolocation?.getCurrentPosition !== "function") {
      queueMicrotask(() => setLocationState("unavailable"));
      return;
    }
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active) return;
        locationRef.current = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setLocationState("available");
      },
      (error) => {
        if (!active) return;
        locationRef.current = null;
        setLocationState(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 30_000 },
    );
    return () => { active = false; };
  }, [cameraActivation, deviceState]);

  useEffect(() => {
    if (deviceState !== "trusted") return;
    if (typeof navigator.permissions?.query !== "function") {
      queueMicrotask(() => setCameraPermission("unsupported"));
      return;
    }
    let active = true;
    let status: PermissionStatus | null = null;
    let publish: (() => void) | null = null;
    void navigator.permissions.query({ name: "camera" as PermissionName })
      .then((result) => {
        if (!active) return;
        status = result;
        publish = () => {
          if (!active || !status) return;
          setCameraPermission(status.state);
          cameraPermissionRef.current = status.state;
          diagnosticsRef.current.cameraPermission = status.state;
        };
        publish();
        status.addEventListener("change", publish);
      })
      .catch(() => {
        if (active) {
          cameraPermissionRef.current = "unsupported";
          setCameraPermission("unsupported");
        }
      });
    return () => {
      active = false;
      if (publish) status?.removeEventListener("change", publish);
    };
  }, [deviceState]);

  function activateCamera() {
    if (deviceState !== "trusted") return;
    releaseCameraRef.current?.();
    locationRef.current = null;
    setLocationState("idle");
    setResult(null);

    if (!window.isSecureContext || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setCameraActivation("unavailable");
      setPhaseState("error");
      setMessage("La cámara requiere una conexión HTTPS segura.");
      return;
    }

    // Keep this call synchronous with the click/tap so Android Chrome can show its permission prompt.
    const request = requestScannerCameraFromUserGesture(navigator.mediaDevices);
    void request.catch(() => undefined);
    cameraRequestRef.current = request;
    diagnosticsRef.current.userGestureStarted = true;
    diagnosticsRef.current.cameraActivationState = "requesting";
    diagnosticsRef.current.lastCameraError = null;
    setCameraActivation("requesting");
    setPhaseState("starting");
    setMessage("Solicitando permiso…");
    setCameraEpoch((value) => value + 1);
  }

  const applyZoom = useCallback(async (requestedZoom: ScannerZoomLevel) => {
    let activeRange = zoomRangeRef.current;
    let zoom = normalizeScannerZoom(requestedZoom, activeRange);
    const request = ++zoomRequestRef.current;
    zoomRef.current = zoom;
    setZoom(zoom);

    const currentVideo = videoRef.current;
    if (!currentVideo) return;
    const video: HTMLVideoElement = currentVideo;
    Object.assign(
      scanRegionRef.current,
      scannerRegion(video.videoWidth, video.videoHeight, zoom, zoomModeRef.current),
    );

    const stream = video.srcObject;
    if (!(stream instanceof MediaStream)) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const mode = await applyPreferredCameraZoom(track, zoom);
    if (request !== zoomRequestRef.current) return;
    if (mode === "digital" && activeRange.mode === "hardware") {
      activeRange = DIGITAL_ZOOM_RANGE;
      zoomRangeRef.current = activeRange;
      setZoomRange(activeRange);
      diagnosticsRef.current.zoomRange = activeRange;
      zoom = normalizeScannerZoom(zoom, activeRange);
      zoomRef.current = zoom;
      setZoom(zoom);
    }
    zoomModeRef.current = mode;
    setZoomMode(mode);
    Object.assign(
      scanRegionRef.current,
      scannerRegion(video.videoWidth, video.videoHeight, zoom, mode),
    );
    video.style.transform = mode === "hardware" ? "none" : `scale(${digitalPreviewScale(zoom)})`;
  }, []);

  useEffect(() => {
    if (deviceState !== "trusted" || cameraEpoch === 0 || !cameraRequestRef.current) return;
    const pendingRequest = cameraRequestRef.current;
    let active = true;
    const currentVideo = videoRef.current;
    if (!currentVideo) return;
    const video: HTMLVideoElement = currentVideo;

    setResult(null);
    zoomRef.current = 1;
    zoomModeRef.current = "unknown";
    zoomRangeRef.current = DIGITAL_ZOOM_RANGE;
    zoomRequestRef.current += 1;
    setZoom(1);
    setZoomMode("unknown");
    setZoomRange(DIGITAL_ZOOM_RANGE);
    setRawQrDetected(false);
    scanRegionModeRef.current = "normal";
    diagnosticsRef.current = {
      ...initialDiagnostics(),
      barcodeDetector: "BarcodeDetector" in window,
      cameraActivationState: "requesting",
      cameraPermission: cameraPermissionRef.current,
      userGestureStarted: true,
    };
    video.style.transform = "none";
    Object.assign(scanRegionRef.current, scannerRegion(video.videoWidth, video.videoHeight, 1, "unknown"));

    function updateScanRegion(mode: "normal" | "recovery" = "normal") {
      scanRegionModeRef.current = mode;
      Object.assign(
        scanRegionRef.current,
        scannerRegion(
          video.videoWidth,
          video.videoHeight,
          zoomRef.current,
          zoomModeRef.current,
          mode === "recovery",
        ),
      );
    }

    let controller: AttendanceScannerController | null = null;

    function destroyCameraSession() {
      const currentController = controller;
      controller = null;
      currentController?.destroy();
      scannerRef.current = null;
      releaseScannerVideo(video);
    }
    releaseCameraRef.current = destroyCameraSession;

    function createController(): AttendanceScannerController {
      return createAttendanceScannerController({
        parse: (value) => extractAttendanceToken(
          value,
          attendanceQrTrustedOrigins(window.location.origin),
        ),
        submit: (token) => submitAttendanceToken(token, locationRef.current ?? undefined),
        createScanner(onDecode) {
        let locked = false;
        const publishDecode = (data: string, source: "qr-scanner" | "zxing") => {
          if (locked) return;
          diagnosticsRef.current.decodeSuccesses += 1;
          diagnosticsRef.current.decoderSource = source;
          onDecode({ data, source });
        };
        const fallback = createDelayedDecoderFallback({
          video,
          onDecode(value) {
            publishDecode(value, "zxing");
          },
          onState(state) {
            diagnosticsRef.current.fallbackState = state;
          },
        });
        const scanner = new QrScanner(video, (decoded) => {
          diagnosticsRef.current.framesAttempted += 1;
          updateScanRegion();
          publishDecode(decoded.data, "qr-scanner");
        }, {
          preferredCamera: "environment",
          maxScansPerSecond: 12,
          calculateScanRegion(source) {
            Object.assign(
              scanRegionRef.current,
              scannerRegion(
                source.videoWidth,
                source.videoHeight,
                zoomRef.current,
                zoomModeRef.current,
                scanRegionModeRef.current === "recovery",
              ),
            );
            return scanRegionRef.current;
          },
          onDecodeError: () => {
            diagnosticsRef.current.framesAttempted += 1;
            diagnosticsRef.current.decodeMisses += 1;
            const recovery = diagnosticsRef.current.decodeMisses % 5 === 4;
            updateScanRegion(recovery ? "recovery" : "normal");
          },
          returnDetailedScanResult: true,
        });
        scanner.setInversionMode("original");
        scannerRef.current = scanner;
        return {
          async start() {
            await scanner.start();
            fallback.schedule();
          },
          lock() {
            locked = true;
            fallback.lock();
          },
          unlock() {
            locked = false;
            fallback.unlock();
          },
          stop() {
            locked = true;
            fallback.stop();
            scanner.stop();
          },
          destroy() {
            locked = true;
            fallback.destroy();
            scanner.destroy();
          },
        };
        },
        onState(nextPhase, nextMessage) {
        if (!active) return;
        diagnosticsRef.current.scannerActive = nextPhase !== "starting" && nextPhase !== "error" && nextPhase !== "success" && nextPhase !== "duplicate";
        if (nextPhase === "scanning") {
          setRawQrDetected(false);
          Object.assign(diagnosticsRef.current, {
            qrDetected: false,
            detectedType: null,
            tokenParsed: false,
            sessionIdentified: false,
            classIdentified: false,
            className: null,
            apiRequest: "No enviada",
            lastEvent: "Sin QR",
          } satisfies Partial<ScannerDiagnostics>);
        }
        if (nextPhase === "transient_error" && nextMessage.startsWith("El código cambió")) {
          diagnosticsRef.current.lastEvent = "QR expirado";
        }
        setPhaseState(nextPhase);
        setMessage(nextMessage);
        },
        onEvent(event: ScannerPipelineEvent) {
        if (!active) return;
        if (event.type === "raw_detected") {
          setRawQrDetected(true);
          Object.assign(diagnosticsRef.current, {
            qrDetected: true,
            decoderSource: event.source,
            lastEvent: "QR detectado",
          } satisfies Partial<ScannerDiagnostics>);
        } else if (event.type === "unrecognized") {
          diagnosticsRef.current.detectedType = "Desconocido";
          diagnosticsRef.current.lastEvent = "Código no reconocido";
        } else if (event.type === "token_parsed") {
          diagnosticsRef.current.detectedType = "Asistencia";
          diagnosticsRef.current.tokenParsed = true;
          diagnosticsRef.current.lastEvent = "Token interpretado";
        } else if (event.type === "api_pending") {
          diagnosticsRef.current.apiRequest = "Pendiente";
          diagnosticsRef.current.lastEvent = "Validando sesión";
        } else if (event.type === "class_identified") {
          Object.assign(diagnosticsRef.current, {
            sessionIdentified: true,
            classIdentified: true,
            className: event.className,
            lastEvent: "Clase identificada",
          } satisfies Partial<ScannerDiagnostics>);
        } else if (event.type === "api_success") {
          diagnosticsRef.current.apiRequest = "Correcta";
        } else if (event.type === "api_error") {
          diagnosticsRef.current.apiRequest = "Error";
          diagnosticsRef.current.lastEvent = event.code === "TOKEN_EXPIRED" ? "QR expirado" : "Error de validación";
        }
        if (debug) setDiagnostics({ ...diagnosticsRef.current });
        },
        onSuccess(nextResult) {
        if (!active) return;
        diagnosticsRef.current.scannerActive = false;
        diagnosticsRef.current.lastEvent = "Asistencia registrada";
        setResult(nextResult);
        if (typeof navigator.vibrate === "function") navigator.vibrate(40);
        setPhaseState(nextResult.status === "already_registered" ? "duplicate" : "success");
        },
      });
    }

    async function prepareStream(stream: MediaStream) {
      if (!active) {
        stopCameraStream(stream);
        throw new DOMException("Camera lifecycle ended", "InvalidStateError");
      }
      video.srcObject = stream;
      controller = createController();
      await controller.start();
      if (!active) {
        destroyCameraSession();
        throw new DOMException("Camera lifecycle ended", "InvalidStateError");
      }

      const track = stream.getVideoTracks()[0];
      if (track) {
        const cameraInfo = await prepareScannerCamera(track);
        if (!active) throw new DOMException("Camera lifecycle ended", "InvalidStateError");
        const detectedZoomRange = scannerZoomRange(track);
        zoomRangeRef.current = detectedZoomRange;
        setZoomRange(detectedZoomRange);
        Object.assign(diagnosticsRef.current, cameraInfo, {
          width: cameraInfo.width ?? (video.videoWidth || null),
          height: cameraInfo.height ?? (video.videoHeight || null),
          zoomRange: detectedZoomRange,
        });
        await applyZoom(detectedZoomRange.min);
        updateScanRegion();
      }
      diagnosticsRef.current.cameraActivationState = "active";
      diagnosticsRef.current.scannerActive = true;
      setCameraActivation("active");
      return stream;
    }

    async function startCamera() {
      let lastError: unknown = new DOMException("Camera unavailable", "NotSupportedError");

      try {
        const requestedStream = await pendingRequest;
        cameraRequestRef.current = null;
        await prepareStream(requestedStream);
        return;
      } catch (error) {
        lastError = error;
        destroyCameraSession();
      }

      const firstFailure = classifyCameraFailure(lastError, window.isSecureContext);
      if (firstFailure.transient && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function") {
        for (const [index, delay] of CAMERA_TRANSIENT_RETRY_DELAYS_MS.entries()) {
          destroyCameraSession();
          setMessage(`Reintentando cámara… (${index + 1}/${CAMERA_TRANSIENT_RETRY_DELAYS_MS.length})`);
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (!active) return;
          try {
            const stream = await acquireScannerCameraStream(navigator.mediaDevices);
            await prepareStream(stream);
            return;
          } catch (error) {
            lastError = error;
            if (!classifyCameraFailure(error, window.isSecureContext).transient) break;
          }
        }
      }

      if (!active) return;
      const failure = classifyCameraFailure(lastError, window.isSecureContext);
      setMessage(failure.message);
      setPhaseState("error");
      const activation = failure.kind === "permission_denied"
        ? cameraPermissionRef.current === "denied" ? "blocked" : "denied"
        : failure.kind === "busy"
          ? "busy"
          : failure.kind === "not_found" || failure.kind === "unsupported"
            ? "unavailable"
            : "error";
      setCameraActivation(activation);
      diagnosticsRef.current.scannerActive = false;
      diagnosticsRef.current.cameraActivationState = activation;
      diagnosticsRef.current.lastCameraError = failure.kind;
      diagnosticsRef.current.lastEvent = failure.kind === "busy" ? "Cámara ocupada" : "Error de cámara";
    }

    function handleVisibility() {
      if (document.visibilityState !== "hidden") return;
      destroyCameraSession();
      diagnosticsRef.current.scannerActive = false;
      diagnosticsRef.current.cameraActivationState = "paused";
      diagnosticsRef.current.lastEvent = "Cámara pausada";
      setCameraActivation("paused");
      setMessage("La cámara se pausó al salir de esta pantalla. Pulsa reactivar para activarla de nuevo.");
      setPhaseState("error");
    }

    document.addEventListener("visibilitychange", handleVisibility);
    const diagnosticsTimer = debug
      ? window.setInterval(() => setDiagnostics({ ...diagnosticsRef.current }), 500)
      : null;
    void startCamera();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (diagnosticsTimer !== null) window.clearInterval(diagnosticsTimer);
      zoomRequestRef.current += 1;
      destroyCameraSession();
      if (releaseCameraRef.current === destroyCameraSession) releaseCameraRef.current = null;
    };
  }, [applyZoom, cameraEpoch, debug, deviceState]);

  const finished = phase === "success" || phase === "duplicate";
  const detectionActive = rawQrDetected || phase === "detected" || phase === "submitting" || phase === "identified";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--campus-navy)]">
      <InstitutionalHeader role="student" homeHref="/student" context="Escanear asistencia" compact />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-8">
        {!finished ? deviceState === "trusted" ? (
          <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="scanner-title">
            <div className="flex items-start justify-between gap-4 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-sky-200">Campus Attendance</p>
                <h1 id="scanner-title" className="mt-2 text-2xl font-semibold sm:text-3xl">Escanear asistencia</h1>
                {attendanceIntent && <p className="mt-2 max-w-xl text-sm leading-6 text-sky-100">Tu cuenta está lista. Vuelve a escanear el código QR que aparece en la pantalla del aula para registrar tu asistencia.</p>}
              </div>
              <Link href="/student" className="min-h-11 rounded-[5px] border border-white/50 px-4 py-2.5 text-sm font-semibold hover:bg-white/10">← Volver al inicio</Link>
            </div>

            <div className="relative mt-5 aspect-[3/4] max-h-[66vh] min-h-[360px] overflow-hidden rounded-[8px] bg-black sm:aspect-[4/3]">
              <video
                ref={videoRef}
                muted
                playsInline
                aria-label="Vista previa de la cámara"
                className={`h-full w-full object-cover transition-[filter,transform] duration-150 ${phase === "submitting" || phase === "identified" ? "blur-[2px] brightness-75" : ""}`}
              />
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10" aria-hidden="true">
                <div className={`scanner-frame relative aspect-square w-[84%] max-w-[420px] ${detectionActive ? "scanner-confirm" : ""}`}>
                  {detectionActive && <span className="scanner-confirm-sweep absolute inset-x-0 top-0 h-1 bg-emerald-300" />}
                </div>
              </div>
              {rawQrDetected && <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold tracking-[0.02em] text-white shadow-lg">QR detectado</div>}
              {cameraActivation === "requesting" && <div className="absolute inset-0 grid place-items-center bg-black/70 px-6 text-center text-white"><PendingButtonLabel>Solicitando permiso…</PendingButtonLabel></div>}
              {cameraActivation !== "requesting" && cameraActivation !== "active" && (
                <div className="absolute inset-0 grid place-items-center bg-slate-950 px-6 text-center text-white">
                  <div className="max-w-md">
                    <div className="mx-auto grid size-16 place-items-center rounded-full border border-sky-300/60 bg-white/10 text-3xl" aria-hidden="true">▣</div>
                    <h2 className="mt-5 text-xl font-semibold">Activar cámara</h2>
                    <p className="mt-3 text-sm leading-6 text-sky-100">Necesitamos acceso a la cámara para leer el código QR de asistencia.</p>
                    <p className="mt-2 text-sm leading-6 text-sky-100">La cámara solo se utiliza mientras estás en esta pantalla.</p>
                    {(cameraActivation !== "idle" || cameraPermission === "denied") && <p className="mt-3 text-sm leading-6 text-white">{cameraGuidance(cameraActivation, cameraPermission)}</p>}
                    <button type="button" onClick={activateCamera} className="campus-primary-button mt-6 min-w-52 bg-white text-[var(--campus-navy)] hover:bg-slate-100">
                      {cameraActivation === "paused" ? "Reactivar cámara" : cameraActivation === "idle" && cameraPermission !== "denied" ? "Activar cámara" : "Reintentar cámara"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p role={phase === "error" ? "alert" : "status"} aria-live="polite" className={`mt-4 min-h-12 border-l-4 px-4 py-3 text-sm ${phase === "error" ? "border-red-400 bg-red-950/60 text-red-50" : detectionActive ? "border-emerald-300 bg-emerald-950/70 text-emerald-50" : phase === "transient_error" ? "border-sky-300 bg-sky-950/70 text-sky-50" : "border-sky-300 bg-white/10 text-white"}`}>
              {message}
            </p>
            <p className="mt-2 text-xs text-sky-100" aria-live="polite">
              {locationLabel(locationState)} La ubicación es evidencia opcional y nunca bloquea el registro.
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-4 text-white">
                <label htmlFor="scanner-zoom" className="text-sm font-semibold">Zoom</label>
                <output htmlFor="scanner-zoom" className="min-w-14 text-right text-sm font-bold tabular-nums">{zoom.toFixed(1)}×</output>
              </div>
              <input
                id="scanner-zoom"
                type="range"
                min={zoomRange.min}
                max={zoomRange.max}
                step={zoomRange.step}
                value={zoom}
                disabled={cameraActivation !== "active" || detectionActive}
                onChange={(event) => void applyZoom(Number(event.target.value))}
                aria-label="Zoom de cámara"
                aria-valuetext={`${zoom.toFixed(1)} aumentos`}
                className="mt-2 h-12 w-full cursor-pointer accent-[var(--campus-blue)] disabled:cursor-not-allowed disabled:opacity-40"
              />
              <p className="text-right text-xs text-sky-100">
                {zoomMode === "hardware" ? "Zoom de cámara" : zoomMode === "digital" ? "Zoom digital" : "Cámara trasera preferida"}
              </p>
              <div className="mt-1 flex justify-between text-xs font-medium text-sky-100" aria-hidden="true">
                <span>{zoomRange.min.toFixed(1)}×</span>
                <span>{zoomRange.max.toFixed(1)}×</span>
              </div>
            </div>

            {debug && <ScannerDebugPanel diagnostics={diagnostics} />}

          </section>
        ) : (
          <DeviceGate state={deviceState} />
        ) : result ? (
          <section className="campus-panel my-auto border-t-4 border-t-[var(--campus-success)] p-6 sm:p-9" aria-live="polite">
            <AttendanceSuccessExperience
              courseName={result.class.name}
              studentName={result.attendance.full_name || displayName}
              studentEmail={email}
              registeredAt={result.attendance.registered_at}
              duplicate={phase === "duplicate"}
              enrolled={result.enrolled}
              motivationalSeed={`${email}:${result.attendance.registered_at}`}
            />
            {debug && <ScannerDebugPanel diagnostics={diagnostics} />}
            <Link href="/student" className="campus-primary-button mt-7 w-full">Volver al inicio</Link>
            <button type="button" onClick={activateCamera} className="mt-3 min-h-11 w-full rounded-[5px] border border-[var(--campus-border)] px-4 text-sm font-semibold text-[var(--campus-navy)]">
              Escanear otro código
            </button>
          </section>
        ) : null}
      </main>
      <InstitutionalFooter />
    </div>
  );
}

function DeviceGate({ state }: { state: DeviceState }) {
  const checking = state === "checking";
  const title = checking
    ? "Verificando dispositivo…"
    : state === "account_mismatch"
      ? "Esta cuenta está vinculada a otro dispositivo."
      : state === "bound_elsewhere"
        ? "Este dispositivo ya está vinculado a otra cuenta."
        : "No se pudo verificar este dispositivo.";
  return (
    <section className="campus-panel my-auto border-t-4 border-t-[var(--campus-blue)] p-6 sm:p-9" aria-live="polite">
      <p className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--campus-blue-dark)]">Dispositivo de confianza</p>
      <h1 className="mt-3 text-2xl font-semibold text-[var(--campus-navy)]">{title}</h1>
      {!checking && (
        <p className="mt-4 leading-7 text-[var(--campus-muted)]">
          Solicita a tu profesor que use “Restablecer dispositivo” con tu correo institucional. Después, vuelve a iniciar esta pantalla desde el nuevo navegador.
        </p>
      )}
      <Link href="/student" className="campus-primary-button mt-7 w-full">Volver al inicio</Link>
    </section>
  );
}

function locationLabel(state: LocationState): string {
  if (state === "idle") return "Ubicación: pendiente hasta activar la cámara.";
  if (state === "requesting") return "Ubicación: solicitando en segundo plano.";
  if (state === "available") return "Ubicación: disponible.";
  if (state === "denied") return "Ubicación: permiso denegado.";
  if (state === "timeout") return "Ubicación: tiempo de espera agotado.";
  return "Ubicación: no disponible.";
}

function cameraGuidance(state: CameraActivationState, permission: CameraPermissionState): string {
  if (state === "paused") return "La cámara se liberó al cambiar de aplicación. Vuelve a activarla para continuar.";
  if (state === "busy") return "Cierra otras aplicaciones que estén usando la cámara y vuelve a intentarlo.";
  if (state === "unavailable") return "Comprueba que estás usando HTTPS y que el dispositivo tiene una cámara disponible.";
  if (state === "blocked" || permission === "denied") {
    return "No pudimos acceder a la cámara. Pulsa el icono de ajustes del sitio en la barra del navegador, permite Cámara y vuelve a intentarlo. El nombre de la opción puede variar según el navegador.";
  }
  if (state === "denied") return "No pudimos acceder a la cámara. Autoriza el permiso cuando el navegador vuelva a solicitarlo.";
  return "No pudimos iniciar la cámara. Comprueba sus permisos y vuelve a intentarlo.";
}

function ScannerDebugPanel({ diagnostics }: { diagnostics: ScannerDiagnostics }) {
  const resolution = diagnostics.width && diagnostics.height
    ? `${diagnostics.width}×${diagnostics.height}`
    : "No disponible";
  return (
    <aside className="mt-4 rounded-[5px] border border-sky-300/50 bg-slate-950/70 p-4 text-xs text-sky-50" aria-label="Diagnóstico seguro del escáner">
      <p className="font-bold uppercase tracking-[0.1em]">Diagnóstico QA</p>
      <dl className="mt-3 grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-2">
        <dt>Cámara</dt><dd>{diagnostics.scannerActive ? "Activa" : "Pausada"}</dd>
        <dt>Activación</dt><dd>{diagnostics.cameraActivationState}</dd>
        <dt>Permiso</dt><dd>{diagnostics.cameraPermission}</dd>
        <dt>Gesto del usuario</dt><dd>{diagnostics.userGestureStarted ? "Sí" : "No"}</dd>
        <dt>Último error de cámara</dt><dd>{diagnostics.lastCameraError ?? "Ninguno"}</dd>
        <dt>Resolución</dt><dd>{resolution}</dd>
        <dt>Orientación</dt><dd>{diagnostics.facingMode || "No disponible"}</dd>
        <dt>Cámara seleccionada</dt><dd className="break-words">{diagnostics.cameraLabel || "Etiqueta no disponible"}</dd>
        <dt>Identificador</dt><dd>{diagnostics.deviceIdPresent ? "Disponible" : "No disponible"}</dd>
        <dt>Autofocus</dt><dd>{diagnostics.continuousFocus ? "Continuo" : "Predeterminado"}</dd>
        <dt>Decoder A</dt><dd>{diagnostics.scannerActive ? "qr-scanner activo" : "Pausado"}</dd>
        <dt>Decoder B</dt><dd>ZXing · {fallbackStateLabel(diagnostics.fallbackState)}</dd>
        <dt>Último decoder</dt><dd>{diagnostics.decoderSource ?? "Ninguno"}</dd>
        <dt>BarcodeDetector</dt><dd>{diagnostics.barcodeDetector ? "Disponible" : "Worker"}</dd>
        <dt>QR detectado</dt><dd>{diagnostics.qrDetected ? "Sí" : "No"}</dd>
        <dt>Tipo</dt><dd>{diagnostics.detectedType ?? "Sin identificar"}</dd>
        <dt>Token interpretado</dt><dd>{diagnostics.tokenParsed ? "Sí" : "No"}</dd>
        <dt>Sesión identificada</dt><dd>{diagnostics.sessionIdentified ? "Sí" : "No"}</dd>
        <dt>Clase identificada</dt><dd>{diagnostics.classIdentified ? "Sí" : "No"}</dd>
        <dt>Clase</dt><dd>{diagnostics.className ?? "No identificada"}</dd>
        <dt>Petición API</dt><dd>{diagnostics.apiRequest}</dd>
        <dt>Intentos</dt><dd>{diagnostics.framesAttempted}</dd>
        <dt>Detecciones</dt><dd>{diagnostics.decodeSuccesses}</dd>
        <dt>Fallos de lectura</dt><dd>{diagnostics.decodeMisses}</dd>
        <dt>Zoom</dt><dd>{diagnostics.zoomRange.mode === "hardware" ? "Hardware" : "Digital"} · {diagnostics.zoomRange.min.toFixed(1)}–{diagnostics.zoomRange.max.toFixed(1)}×</dd>
        <dt>Último evento</dt><dd>{diagnostics.lastEvent}</dd>
      </dl>
    </aside>
  );
}

function fallbackStateLabel(state: FallbackDecoderState): string {
  if (state === "waiting") return "en espera";
  if (state === "starting") return "iniciando";
  if (state === "active") return "activo";
  if (state === "locked") return "bloqueado";
  if (state === "failed") return "no disponible";
  return "inactivo";
}

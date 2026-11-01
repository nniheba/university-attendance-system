import {
  extractAttendanceToken,
  submitAttendanceToken,
  type ScanAttendanceResult,
  type ScanAttendanceSuccess,
} from "@/lib/attendance/scan";

export type ScannerPhase =
  | "starting"
  | "scanning"
  | "detected"
  | "submitting"
  | "identified"
  | "transient_error"
  | "error"
  | "success"
  | "duplicate";

export interface DetailedScanResult {
  data: string;
  source?: "qr-scanner" | "zxing";
}

export interface WebcamScanner {
  start(): Promise<void>;
  lock?(): void;
  unlock?(): void;
  stop(): void;
  destroy(): void;
}

export type ScannerPipelineEvent =
  | { type: "raw_detected"; source: "qr-scanner" | "zxing" }
  | { type: "token_parsed" }
  | { type: "unrecognized" }
  | { type: "api_pending" }
  | { type: "class_identified"; className: string }
  | { type: "api_success" }
  | { type: "api_error"; code: string };

interface ScannerControllerOptions {
  createScanner: (onDecode: (result: DetailedScanResult) => void) => WebcamScanner;
  onState: (phase: ScannerPhase, message: string) => void;
  onSuccess: (result: ScanAttendanceSuccess) => void;
  onEvent?: (event: ScannerPipelineEvent) => void;
  submit?: (token: string) => Promise<ScanAttendanceResult>;
  parse?: (value: string) => string | null;
  setTimer?: typeof globalThis.setTimeout;
  clearTimer?: typeof globalThis.clearTimeout;
}

export interface AttendanceScannerController {
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
}

const SCANNING_MESSAGE = "Enfoca el código QR mostrado por el profesor.";

export function createAttendanceScannerController({
  createScanner,
  onState,
  onSuccess,
  onEvent = () => undefined,
  submit = submitAttendanceToken,
  parse = extractAttendanceToken,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
}: ScannerControllerOptions): AttendanceScannerController {
  let phase: ScannerPhase = "starting";
  let destroyed = false;
  let resumeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let successTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  function setPhase(next: ScannerPhase, message: string) {
    phase = next;
    onState(next, message);
  }

  function resumeAfter(message: string, delayMs: number) {
    if (resumeTimer !== null) clearTimer(resumeTimer);
    setPhase("transient_error", message);
    resumeTimer = setTimer(() => {
      resumeTimer = null;
      if (!destroyed) {
        scanner.unlock?.();
        setPhase("scanning", SCANNING_MESSAGE);
      }
    }, delayMs);
  }

  async function handleDecode(result: DetailedScanResult) {
    if (destroyed || phase !== "scanning") return;
    scanner.lock?.();
    onEvent({ type: "raw_detected", source: result.source ?? "qr-scanner" });
    setPhase("detected", "QR DETECTADO");
    const token = parse(result.data);
    if (!token) {
      onEvent({ type: "unrecognized" });
      resumeAfter("Código no reconocido", 700);
      return;
    }

    onEvent({ type: "token_parsed" });
    // Lock synchronously before the request so repeated decoder callbacks
    // cannot create duplicate attendance submissions.
    setPhase("submitting", "Código detectado");
    onEvent({ type: "api_pending" });
    let response: ScanAttendanceResult;
    try {
      response = await submit(token);
    } catch {
      onEvent({ type: "api_error", code: "NETWORK_ERROR" });
      scanner.stop();
      setPhase("error", "No se pudo conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.");
      return;
    }
    if (destroyed) return;

    if (response.ok) {
      onEvent({ type: "class_identified", className: response.class.name });
      onEvent({ type: "api_success" });
      setPhase("identified", `Clase identificada · ${response.class.name}`);
      successTimer = setTimer(() => {
        successTimer = null;
        if (destroyed) return;
        scanner.stop();
        phase = response.status === "already_registered" ? "duplicate" : "success";
        onSuccess(response);
      }, 250);
      return;
    }

    onEvent({ type: "api_error", code: response.code });
    if (response.code === "TOKEN_EXPIRED") {
      resumeAfter("El código cambió. Enfoca el nuevo código.", 900);
      return;
    }
    if (response.code === "INVALID_TOKEN") {
      resumeAfter(response.message, 900);
      return;
    }

    scanner.stop();
    setPhase("error", response.message);
  }

  const scanner = createScanner((result) => void handleDecode(result));

  return {
    async start() {
      setPhase("starting", "Preparando la cámara…");
      await scanner.start();
      if (!destroyed) setPhase("scanning", SCANNING_MESSAGE);
    },
    stop() {
      if (resumeTimer !== null) {
        clearTimer(resumeTimer);
        resumeTimer = null;
      }
      if (successTimer !== null) {
        clearTimer(successTimer);
        successTimer = null;
      }
      scanner.stop();
    },
    destroy() {
      destroyed = true;
      if (resumeTimer !== null) clearTimer(resumeTimer);
      if (successTimer !== null) clearTimer(successTimer);
      resumeTimer = null;
      successTimer = null;
      scanner.destroy();
    },
  };
}

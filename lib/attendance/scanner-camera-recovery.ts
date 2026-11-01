export type CameraFailureKind =
  | "permission_denied"
  | "not_found"
  | "busy"
  | "temporary"
  | "unsupported_constraints"
  | "unsupported"
  | "unknown";

export interface CameraFailure {
  kind: CameraFailureKind;
  message: string;
  transient: boolean;
}

type CameraMediaDevices = Pick<MediaDevices, "getUserMedia">;

export const CAMERA_INITIAL_RELEASE_DELAY_MS = 200;
export const CAMERA_TRANSIENT_RETRY_DELAYS_MS = [400, 900] as const;

export const PREFERRED_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1_920 },
    height: { ideal: 1_080 },
  },
};

export const SIMPLE_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: true,
};

function errorName(error: unknown): string {
  if (!error || typeof error !== "object" || !("name" in error)) return "";
  return typeof error.name === "string" ? error.name : "";
}

export function classifyCameraFailure(error: unknown, secureContext = true): CameraFailure {
  if (!secureContext || errorName(error) === "NotSupportedError") {
    return {
      kind: "unsupported",
      message: "La cámara requiere una conexión HTTPS segura y un navegador compatible.",
      transient: false,
    };
  }

  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "permission_denied",
        message: "El permiso de cámara está bloqueado. Autorízalo en los ajustes del navegador y vuelve a intentarlo.",
        transient: false,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        kind: "not_found",
        message: "No encontramos una cámara disponible en este dispositivo.",
        transient: false,
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        kind: "busy",
        message: "La cámara está siendo utilizada por otra aplicación. Ciérrala y vuelve a intentarlo.",
        transient: true,
      };
    case "AbortError":
      return {
        kind: "temporary",
        message: "No pudimos activar la cámara por un fallo temporal. Vuelve a intentarlo.",
        transient: true,
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return {
        kind: "unsupported_constraints",
        message: "La configuración solicitada no es compatible con esta cámara. Vuelve a intentarlo.",
        transient: false,
      };
    default:
      return {
        kind: "unknown",
        message: "No pudimos iniciar la cámara. Comprueba que esté disponible y vuelve a intentarlo.",
        transient: false,
      };
  }
}

export async function acquireScannerCameraStream(mediaDevices: CameraMediaDevices): Promise<MediaStream> {
  try {
    return await mediaDevices.getUserMedia(PREFERRED_CAMERA_CONSTRAINTS);
  } catch (error) {
    if (classifyCameraFailure(error).kind !== "unsupported_constraints") throw error;
    return mediaDevices.getUserMedia(SIMPLE_CAMERA_CONSTRAINTS);
  }
}

/** Must be called directly from the student's click/tap handler. */
export function requestScannerCameraFromUserGesture(mediaDevices: CameraMediaDevices): Promise<MediaStream> {
  return acquireScannerCameraStream(mediaDevices);
}

interface CameraRecoveryOptions<T> {
  startAttempt: () => Promise<T>;
  cleanup: () => void;
  wait?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number) => void;
  secureContext?: boolean;
}

export async function runCameraRecovery<T>({
  startAttempt,
  cleanup,
  wait = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  onRetry = () => undefined,
  secureContext = true,
}: CameraRecoveryOptions<T>): Promise<T> {
  cleanup();
  await wait(CAMERA_INITIAL_RELEASE_DELAY_MS);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await startAttempt();
    } catch (error) {
      cleanup();
      const failure = classifyCameraFailure(error, secureContext);
      const retryDelay = CAMERA_TRANSIENT_RETRY_DELAYS_MS[attempt];
      if (!failure.transient || retryDelay === undefined) throw error;
      onRetry(attempt + 1, retryDelay);
      await wait(retryDelay);
    }
  }
}

function mediaStreamTracks(value: unknown): MediaStreamTrack[] {
  if (!value || typeof value !== "object" || !("getTracks" in value)) return [];
  const getTracks = value.getTracks;
  if (typeof getTracks !== "function") return [];
  return getTracks.call(value) as MediaStreamTrack[];
}

export function stopCameraStream(stream: unknown): void {
  for (const track of mediaStreamTracks(stream)) track.stop();
}

export function releaseScannerVideo(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // Some browser mocks and detached elements do not implement pause.
  }
  stopCameraStream(video.srcObject);
  video.srcObject = null;
}

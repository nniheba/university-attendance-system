export type ScannerZoomLevel = number;
export type ScannerZoomMode = "hardware" | "digital" | "unknown";

export interface ScannerRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  downScaledWidth: number;
  downScaledHeight: number;
}

export interface ScannerZoomRange {
  min: number;
  max: number;
  step: number;
  mode: "hardware" | "digital";
}

interface CapabilityRange {
  min: number;
  max: number;
  step?: number;
}

interface ZoomTrack {
  getCapabilities?: () => MediaTrackCapabilities;
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>;
}

const DIGITAL_MIN_ZOOM = 1;
const DIGITAL_MAX_ZOOM = 2;
const MAX_HARDWARE_ZOOM = 5;
const MIN_DIGITAL_REGION_RATIO = 0.51;
const MAX_PRIMARY_REGION_RATIO = 0.88;
const RECOVERY_REGION_RATIO = 0.98;

export const DIGITAL_ZOOM_RANGE: ScannerZoomRange = {
  min: DIGITAL_MIN_ZOOM,
  max: DIGITAL_MAX_ZOOM,
  step: 0.1,
  mode: "digital",
};

function validZoomRange(value: unknown): CapabilityRange | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CapabilityRange>;
  if (
    typeof candidate.min !== "number" ||
    typeof candidate.max !== "number" ||
    !Number.isFinite(candidate.min) ||
    !Number.isFinite(candidate.max) ||
    candidate.max <= candidate.min
  ) return null;
  return {
    min: candidate.min,
    max: candidate.max,
    ...(typeof candidate.step === "number" && candidate.step > 0 ? { step: candidate.step } : {}),
  };
}

export function scannerZoomRange(track: Pick<ZoomTrack, "getCapabilities">): ScannerZoomRange {
  try {
    const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
    const range = validZoomRange(
      (capabilities as MediaTrackCapabilities & { zoom?: unknown }).zoom,
    );
    if (!range) return DIGITAL_ZOOM_RANGE;
    const min = Math.max(1, range.min);
    const max = Math.min(MAX_HARDWARE_ZOOM, range.max);
    if (max <= min) return DIGITAL_ZOOM_RANGE;
    const step = range.step && range.step >= 0.1 && range.step <= 1 ? range.step : 0.1;
    return { min, max, step, mode: "hardware" };
  } catch {
    return DIGITAL_ZOOM_RANGE;
  }
}

export function normalizeScannerZoom(
  value: number,
  range: ScannerZoomRange = DIGITAL_ZOOM_RANGE,
): ScannerZoomLevel {
  const finite = Number.isFinite(value) ? value : range.min;
  const clamped = Math.max(range.min, Math.min(range.max, finite));
  const steps = Math.round((clamped - range.min) / range.step);
  const stepped = range.min + steps * range.step;
  return Number(Math.max(range.min, Math.min(range.max, stepped)).toFixed(3));
}

function digitalRegionRatio(zoom: ScannerZoomLevel): number {
  const normalized = normalizeScannerZoom(zoom);
  const progress = (normalized - DIGITAL_MIN_ZOOM) / (DIGITAL_MAX_ZOOM - DIGITAL_MIN_ZOOM);
  return MAX_PRIMARY_REGION_RATIO - progress * (MAX_PRIMARY_REGION_RATIO - MIN_DIGITAL_REGION_RATIO);
}

export function scannerRegion(
  videoWidth: number,
  videoHeight: number,
  zoom: ScannerZoomLevel,
  mode: ScannerZoomMode,
  recovery = false,
): ScannerRegion {
  const safeWidth = Math.max(1, Math.floor(Number.isFinite(videoWidth) ? videoWidth : 1));
  const safeHeight = Math.max(1, Math.floor(Number.isFinite(videoHeight) ? videoHeight : 1));
  const ratio = recovery
    ? RECOVERY_REGION_RATIO
    : mode === "digital"
      ? digitalRegionRatio(zoom)
      : MAX_PRIMARY_REGION_RATIO;
  const size = Math.max(
    1,
    Math.min(safeWidth, safeHeight, Math.floor(Math.min(safeWidth, safeHeight) * ratio)),
  );
  const decodeSize = recovery ? 800 : 720;
  return {
    x: Math.floor((safeWidth - size) / 2),
    y: Math.floor((safeHeight - size) / 2),
    width: size,
    height: size,
    downScaledWidth: decodeSize,
    downScaledHeight: decodeSize,
  };
}

export function digitalPreviewScale(zoom: ScannerZoomLevel): number {
  return Math.min(2, MAX_PRIMARY_REGION_RATIO / digitalRegionRatio(zoom));
}

export async function applyPreferredCameraZoom(
  track: ZoomTrack,
  requestedZoom: ScannerZoomLevel,
): Promise<"hardware" | "digital"> {
  const range = scannerZoomRange(track);
  if (range.mode !== "hardware") return "digital";
  const target = normalizeScannerZoom(requestedZoom, range);
  try {
    await track.applyConstraints({ advanced: [{ zoom: target } as MediaTrackConstraintSet] });
    return "hardware";
  } catch {
    if (target !== range.min) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: range.min } as MediaTrackConstraintSet] });
      } catch {
        // Some browsers expose zoom but reject every zoom constraint.
      }
    }
    return "digital";
  }
}

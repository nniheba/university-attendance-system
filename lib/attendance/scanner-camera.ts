export interface ScannerCameraInfo {
  width: number | null;
  height: number | null;
  facingMode: string | null;
  deviceIdPresent: boolean;
  cameraLabel: string | null;
  continuousFocus: boolean;
}

interface CameraTrack {
  label?: string;
  getCapabilities?: () => MediaTrackCapabilities;
  getSettings?: () => MediaTrackSettings;
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>;
}

interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[];
}

export async function prepareScannerCamera(track: CameraTrack): Promise<ScannerCameraInfo> {
  try {
    await track.applyConstraints({
      width: { ideal: 1_920 },
      height: { ideal: 1_080 },
    });
  } catch {
    // Ideal resolution is best-effort and must never block scanning.
  }

  let continuousFocus = false;
  try {
    const capabilities = track.getCapabilities?.() as ExtendedCapabilities | undefined;
    if (capabilities?.focusMode?.includes("continuous")) {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
      });
      continuousFocus = true;
    }
  } catch {
    // Safari and some Android devices expose but reject focus constraints.
  }

  const settings = track.getSettings?.();
  return {
    width: typeof settings?.width === "number" ? settings.width : null,
    height: typeof settings?.height === "number" ? settings.height : null,
    facingMode: typeof settings?.facingMode === "string" ? settings.facingMode : null,
    deviceIdPresent: Boolean(settings?.deviceId),
    cameraLabel: track.label?.trim() || null,
    continuousFocus,
  };
}

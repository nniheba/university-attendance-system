import { describe, expect, it, vi } from "vitest";
import {
  acquireScannerCameraStream,
  CAMERA_INITIAL_RELEASE_DELAY_MS,
  CAMERA_TRANSIENT_RETRY_DELAYS_MS,
  classifyCameraFailure,
  PREFERRED_CAMERA_CONSTRAINTS,
  releaseScannerVideo,
  requestScannerCameraFromUserGesture,
  runCameraRecovery,
  SIMPLE_CAMERA_CONSTRAINTS,
} from "@/lib/attendance/scanner-camera-recovery";

function cameraError(name: string) {
  return Object.assign(new Error(name), { name });
}

describe("scanner camera recovery", () => {
  it.each([
    ["NotAllowedError", "permission_denied", "permiso de cámara", false],
    ["NotFoundError", "not_found", "No encontramos una cámara", false],
    ["NotReadableError", "busy", "utilizada por otra aplicación", true],
    ["TrackStartError", "busy", "utilizada por otra aplicación", true],
    ["AbortError", "temporary", "fallo temporal", true],
    ["OverconstrainedError", "unsupported_constraints", "no es compatible", false],
  ])("maps %s to a specific recoverable state", (name, kind, copy, transient) => {
    expect(classifyCameraFailure(cameraError(name))).toMatchObject({ kind, transient });
    expect(classifyCameraFailure(cameraError(name)).message).toContain(copy);
  });

  it("falls back to a simple stream when preferred constraints are unsupported", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(cameraError("OverconstrainedError"))
      .mockResolvedValueOnce(stream);

    await expect(acquireScannerCameraStream({ getUserMedia })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, PREFERRED_CAMERA_CONSTRAINTS);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, SIMPLE_CAMERA_CONSTRAINTS);
  });

  it("starts the first getUserMedia request synchronously from the activation call", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);

    const request = requestScannerCameraFromUserGesture({ getUserMedia });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(PREFERRED_CAMERA_CONSTRAINTS);
    await expect(request).resolves.toBe(stream);
  });

  it("retries transient failures twice with cleanup between attempts", async () => {
    const startAttempt = vi.fn()
      .mockRejectedValueOnce(cameraError("NotReadableError"))
      .mockRejectedValueOnce(cameraError("AbortError"))
      .mockResolvedValueOnce("camera-ready");
    const cleanup = vi.fn();
    const delays: number[] = [];
    const retries: Array<[number, number]> = [];

    await expect(runCameraRecovery({
      startAttempt,
      cleanup,
      wait: async (milliseconds) => { delays.push(milliseconds); },
      onRetry: (attempt, delay) => retries.push([attempt, delay]),
    })).resolves.toBe("camera-ready");

    expect(startAttempt).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([CAMERA_INITIAL_RELEASE_DELAY_MS, ...CAMERA_TRANSIENT_RETRY_DELAYS_MS]);
    expect(retries).toEqual([[1, 400], [2, 900]]);
  });

  it("does not retry denied permission and stops after bounded transient retries", async () => {
    const permissionStart = vi.fn().mockRejectedValue(cameraError("NotAllowedError"));
    await expect(runCameraRecovery({
      startAttempt: permissionStart,
      cleanup: vi.fn(),
      wait: async () => undefined,
    })).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(permissionStart).toHaveBeenCalledTimes(1);

    const busyStart = vi.fn().mockRejectedValue(cameraError("TrackStartError"));
    await expect(runCameraRecovery({
      startAttempt: busyStart,
      cleanup: vi.fn(),
      wait: async () => undefined,
    })).rejects.toMatchObject({ name: "TrackStartError" });
    expect(busyStart).toHaveBeenCalledTimes(3);
  });

  it("stops every owned track and clears the video element", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const stream = { getTracks: () => [{ stop: stopA }, { stop: stopB }] };
    const pause = vi.fn();
    const video = { srcObject: stream, pause } as unknown as HTMLVideoElement;

    releaseScannerVideo(video);

    expect(pause).toHaveBeenCalledOnce();
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });
});

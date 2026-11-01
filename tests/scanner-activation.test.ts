import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scanner = readFileSync(new URL("../components/student-scanner.tsx", import.meta.url), "utf8");

describe("Android-style camera permission lifecycle", () => {
  it("does not acquire camera when trusted-device state changes", () => {
    const trustEffect = scanner.slice(scanner.indexOf('fetch("/api/student/device"'), scanner.indexOf("const applyZoom"));
    expect(trustEffect).not.toContain("getUserMedia(");
    expect(scanner).toContain('useState<CameraActivationState>("idle")');
    expect(scanner).toContain("Activar cámara");
  });

  it("puts the first media request directly in the user activation handler", () => {
    const activation = scanner.slice(scanner.indexOf("function activateCamera()"), scanner.indexOf("const applyZoom"));
    const requestIndex = activation.indexOf("requestScannerCameraFromUserGesture(navigator.mediaDevices)");
    expect(requestIndex).toBeGreaterThan(0);
    const beforeRequest = activation.slice(0, requestIndex);
    expect(beforeRequest).not.toContain("setTimeout");
    expect(beforeRequest).not.toContain("geolocation");
    expect(beforeRequest).not.toContain("await ");
    expect(beforeRequest).not.toContain("fetch(");
  });

  it("does not automatically retry denied permission and bounds busy-camera recovery", () => {
    expect(scanner).toContain('failure.kind === "permission_denied"');
    expect(scanner).toContain("CAMERA_TRANSIENT_RETRY_DELAYS_MS.entries()");
    expect(scanner).toContain("Reintentar cámara");
    expect(scanner).not.toContain("runCameraRecovery({");
  });

  it("releases on hidden and requires a fresh reactivation tap", () => {
    expect(scanner).toContain('document.visibilityState !== "hidden"');
    expect(scanner).toContain("destroyCameraSession()");
    expect(scanner).toContain('setCameraActivation("paused")');
    expect(scanner).toContain("Reactivar cámara");
    expect(scanner).not.toContain('document.visibilityState === "visible"');
  });

  it("starts optional GPS only after the camera is active and exposes safe diagnostics", () => {
    expect(scanner).toContain('cameraActivation !== "active"');
    expect(scanner).toContain('cameraActivationState: CameraActivationState');
    expect(scanner).toContain('cameraPermission: CameraPermissionState');
    expect(scanner).toContain("userGestureStarted: boolean");
    expect(scanner).toContain("lastCameraError: string | null");
    expect(scanner).not.toContain("deviceId:");
  });
});

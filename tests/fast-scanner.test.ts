import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { extractAttendanceToken } from "@/lib/attendance/scan";
import {
  applyPreferredCameraZoom,
  digitalPreviewScale,
  normalizeScannerZoom,
  scannerRegion,
  scannerZoomRange,
} from "@/lib/attendance/scanner-zoom";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const token = "eyJraW5kIjoicXIifQ.signature_value";

describe("v0.5.1 in-app scanner", () => {
  it("extracts attendance tokens only from trusted attendance URLs", () => {
    const compact = `q2.AAAAAAAAAAAAAAAAAAAAAA.mmx12345.AAAAAAAAAAAAAAAA.${"A".repeat(43)}`;
    expect(extractAttendanceToken(`attendance:${compact}`)).toBe(compact);
    expect(extractAttendanceToken(`https://preview.example/attendance/${token}`, ["https://preview.example"])).toBe(token);
    expect(extractAttendanceToken(token)).toBe(token);
    expect(extractAttendanceToken(`https://evil.example/attendance/${token}`, ["https://preview.example"])).toBeNull();
    expect(extractAttendanceToken(`https://preview.example/login?token=${token}`, ["https://preview.example"])).toBeNull();
    expect(extractAttendanceToken("javascript:alert(1)")).toBeNull();
  });

  it("uses qr-scanner's continuous webcam API with the rear camera and throttled cadence", () => {
    const scanner = source("components/student-scanner.tsx");
    expect(scanner).toContain("new QrScanner(video, (decoded)");
    expect(scanner).toContain('preferredCamera: "environment"');
    expect(scanner).toContain("maxScansPerSecond: 12");
    expect(scanner).toContain("calculateScanRegion(source)");
    expect(scanner).toContain("returnDetailedScanResult: true");
    expect(scanner).toContain("await controller.start()");
    expect(scanner).toContain("diagnosticsRef.current.decodeMisses % 5 === 4");
    expect(scanner).toContain('updateScanRegion(recovery ? "recovery" : "normal")');
    expect(scanner).toContain('scanRegionModeRef.current === "recovery"');
    expect(scanner).toContain("createDelayedDecoderFallback");
    expect(scanner).toContain('publishDecode(value, "zxing")');
    const fallback = source("lib/attendance/zxing-fallback.ts");
    expect(fallback).toContain("decodeFromVideoElement(video");
    expect(fallback).not.toContain("getUserMedia");
    expect(fallback).not.toContain("decodeFromVideoDevice");
    expect(scanner).not.toContain("QrScanner.scanImage");
    expect(scanner).not.toContain("QrScanner.createQrEngine");
    expect(scanner).not.toContain("SCAN_INTERVAL_MS");
  });

  it("uses smooth, progressively smaller centered decoder crops for digital zoom", () => {
    const levels = [1, 1.2, 1.5, 1.8, 2];
    const regions = levels.map((level) => scannerRegion(1_920, 1_080, level, "digital"));

    expect(regions.map((region) => region.width)).toEqual([950, 870, 750, 630, 550]);
    for (let index = 1; index < regions.length; index += 1) {
      expect(regions[index - 1].width).toBeGreaterThan(regions[index].width);
    }

    for (const region of regions) {
      expect(Math.abs(region.x * 2 + region.width - 1_920)).toBeLessThanOrEqual(1);
      expect(Math.abs(region.y * 2 + region.height - 1_080)).toBeLessThanOrEqual(1);
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.width).toBeLessThanOrEqual(1_920);
      expect(region.y + region.height).toBeLessThanOrEqual(1_080);
    }
    expect(digitalPreviewScale(1)).toBe(1);
    expect(digitalPreviewScale(1.5)).toBeCloseTo(1.266, 3);
    expect(digitalPreviewScale(2)).toBeCloseTo(1.725, 3);

    const hardwareTwo = scannerRegion(1_920, 1_080, 2, "hardware");
    expect(hardwareTwo.width).toBe(regions[0].width);

    const tiny = scannerRegion(0, Number.NaN, 2, "digital");
    expect(tiny).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });

    const recovery = scannerRegion(1_920, 1_080, 2, "digital", true);
    expect(recovery).toMatchObject({ width: 1_058, height: 1_058, downScaledWidth: 800, downScaledHeight: 800 });
    expect(regions[0]).toMatchObject({ downScaledWidth: 720, downScaledHeight: 720 });
  });

  it("normalizes slider values to the supported 1.0–2.0 range", () => {
    expect(normalizeScannerZoom(0.3)).toBe(1);
    expect(normalizeScannerZoom(1.46)).toBe(1.5);
    expect(normalizeScannerZoom(2.8)).toBe(2);
  });

  it("derives a literal hardware slider capped at 5x", () => {
    const hardware = scannerZoomRange({
      getCapabilities: () => ({ zoom: { min: 1, max: 8, step: 0.1 } }) as MediaTrackCapabilities,
    });
    expect(hardware).toEqual({ min: 1, max: 5, step: 0.1, mode: "hardware" });
    expect(normalizeScannerZoom(2.5, hardware)).toBe(2.5);

    const limited = scannerZoomRange({
      getCapabilities: () => ({ zoom: { min: 1, max: 3 } }) as MediaTrackCapabilities,
    });
    expect(limited.max).toBe(3);
  });

  it("uses hardware constraints when zoom capability is supported", async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const mode = await applyPreferredCameraZoom({
      getCapabilities: () => ({ zoom: { min: 1, max: 8 } }) as MediaTrackCapabilities,
      applyConstraints,
    }, 1.5);
    expect(mode).toBe("hardware");
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1.5 }] });
  });

  it("falls back to digital zoom when a hardware constraint fails", async () => {
    const applyConstraints = vi.fn()
      .mockRejectedValueOnce(new Error("unsupported"))
      .mockResolvedValueOnce(undefined);
    const mode = await applyPreferredCameraZoom({
      getCapabilities: () => ({ zoom: { min: 1, max: 5 } }) as MediaTrackCapabilities,
      applyConstraints,
    }, 1.8);
    expect(mode).toBe("digital");
    expect(applyConstraints).toHaveBeenNthCalledWith(1, { advanced: [{ zoom: 1.8 }] });
    expect(applyConstraints).toHaveBeenNthCalledWith(2, { advanced: [{ zoom: 1 }] });
  });

  it("requires explicit camera activation, releases on visibility changes and only then requests optional GPS", () => {
    const scanner = source("components/student-scanner.tsx");
    expect(scanner).toContain("function activateCamera()");
    expect(scanner).toContain("requestScannerCameraFromUserGesture(navigator.mediaDevices)");
    expect(scanner).toContain('useState<CameraActivationState>("idle")');
    expect(scanner).toContain("cameraActivation !== \"active\"");
    expect(scanner).toContain("currentController?.destroy()");
    expect(scanner).toContain("releaseScannerVideo(video)");
    expect(scanner).toContain("destroyCameraSession();");
    expect(scanner).toContain('document.addEventListener("visibilitychange"');
    expect(scanner).toContain("Reactivar cámara");
    expect(scanner).toContain("Activar cámara");
    expect(scanner).toContain("navigator.geolocation.getCurrentPosition");
    expect(scanner).toContain("timeout: 5_000");
    expect(scanner).toContain("maximumAge: 30_000");
  });

  it("exposes a smooth and accessible zoom slider instead of preset buttons", () => {
    const scanner = source("components/student-scanner.tsx");
    expect(scanner).toContain('type="range"');
    expect(scanner).toContain("min={zoomRange.min}");
    expect(scanner).toContain("max={zoomRange.max}");
    expect(scanner).toContain("step={zoomRange.step}");
    expect(scanner).toContain('aria-valuetext={`${zoom.toFixed(1)} aumentos`}');
    expect(scanner).not.toContain("Zoom ${level}x");
  });

  it("keeps the scanner controls on their high-contrast navy background", () => {
    const scanner = source("components/student-scanner.tsx");
    expect(scanner).toContain('className="flex min-h-screen flex-col bg-[var(--campus-navy)]"');
    expect(scanner).not.toContain('className="campus-page flex min-h-screen flex-col bg-[var(--campus-navy)]"');
  });

  it("keeps diagnostics opt-in and never displays token contents", () => {
    const scanner = source("components/student-scanner.tsx");
    const page = source("app/student/scan/page.tsx");
    expect(page).toContain('debug={debug === "1"}');
    expect(scanner).toContain("Diagnóstico QA");
    expect(scanner).toContain("framesAttempted");
    expect(scanner).toContain("QR detectado");
    expect(scanner).toContain("Token interpretado");
    expect(scanner).toContain("Sesión identificada");
    expect(scanner).toContain("Clase identificada");
    expect(scanner).toContain("Petición API");
    expect(scanner).not.toContain("result.data");
  });

  it("keeps the native-camera URL flow on the same atomic endpoint", () => {
    const externalFlow = source("components/student-attendance.tsx");
    expect(externalFlow).toContain("submitAttendanceToken(qrToken)");
    expect(externalFlow).not.toContain("registrationToken");
    expect(externalFlow).not.toContain("getCurrentPosition");
  });

  it("renders a separate protected projection without exposing attendance evidence", () => {
    const projection = source("components/teacher-projection.tsx");
    const page = source("app/teacher/sessions/[sessionId]/projection/page.tsx");
    expect(projection).toContain("Registra tu asistencia");
    expect(projection).not.toContain("Entra al sistema");
    expect(projection).not.toContain("StaticAccessQr");
    expect(projection).toContain("margin: 3");
    expect(projection).toContain('color: { dark: "#000000", light: "#ffffff" }');
    expect(projection).not.toContain("teacher_note");
    expect(projection).not.toContain("gps_status");
    expect(page).toContain("teacherOwnsSession");
    expect(projection).not.toContain("setQrUrl");
  });
});

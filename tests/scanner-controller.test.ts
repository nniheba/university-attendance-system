import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAttendanceScannerController,
  type DetailedScanResult,
  type ScannerPhase,
  type WebcamScanner,
} from "@/lib/attendance/scanner-controller";
import type { ScanAttendanceResult } from "@/lib/attendance/scan";

const token = `q2.Ej5FZ-ibQtOkVkJmFBdAAA.mmx12345.AAAAAAAAAAAAAAAA.${"A".repeat(43)}`;
const qrValue = `attendance:${token}`;

function success(status: "registered" | "already_registered" = "registered"): ScanAttendanceResult {
  return {
    ok: true,
    status,
    enrolled: false,
    session: { id: "session-1" },
    attendance: {
      id: "attendance-1",
      full_name: "Student One",
      registered_at: "2026-09-22T10:00:00Z",
    },
    class: { id: "class-1", name: "Arquitectura", teacher_name: "Docente Uno" },
  };
}

function setup(
  submit = vi.fn<(value: string) => Promise<ScanAttendanceResult>>().mockResolvedValue(success()),
) {
  let decode: ((result: DetailedScanResult) => void) | null = null;
  const scanner: WebcamScanner = {
    start: vi.fn().mockResolvedValue(undefined),
    lock: vi.fn(),
    unlock: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  };
  const states: Array<{ phase: ScannerPhase; message: string }> = [];
  const onSuccess = vi.fn();
  const events: string[] = [];
  const controller = createAttendanceScannerController({
    createScanner(callback) {
      decode = callback;
      return scanner;
    },
    onState(phase, message) {
      states.push({ phase, message });
    },
    onSuccess,
    onEvent(event) {
      events.push(event.type);
    },
    submit,
  });
  return {
    controller,
    scanner,
    states,
    onSuccess,
    events,
    submit,
    decode(result: string) {
      if (!decode) throw new Error("Scanner callback was not configured");
      decode({ data: result });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("continuous attendance scanner controller", () => {
  it("starts the webcam scanner and decodes detailed result data", async () => {
    const harness = setup();
    await harness.controller.start();
    harness.decode(qrValue);
    await vi.waitFor(() => expect(harness.submit).toHaveBeenCalledWith(token));
    await vi.waitFor(() => expect(harness.onSuccess).toHaveBeenCalledWith(success()));
    expect(harness.scanner.start).toHaveBeenCalledOnce();
    expect(harness.scanner.stop).toHaveBeenCalledOnce();
    expect(harness.states).toContainEqual({ phase: "detected", message: "QR DETECTADO" });
    expect(harness.states).toContainEqual({ phase: "identified", message: "Clase identificada · Arquitectura" });
    expect(harness.events).toEqual([
      "raw_detected",
      "token_parsed",
      "api_pending",
      "class_identified",
      "api_success",
    ]);
  });

  it("locks repeated decode callbacks while the first request is pending", async () => {
    let resolve!: (result: ScanAttendanceResult) => void;
    const submit = vi.fn<(value: string) => Promise<ScanAttendanceResult>>().mockImplementation(
      () => new Promise((done) => { resolve = done; }),
    );
    const harness = setup(submit);
    await harness.controller.start();
    harness.decode(qrValue);
    harness.decode(qrValue);
    harness.decode(qrValue);
    expect(submit).toHaveBeenCalledOnce();
    expect(harness.states.at(-1)).toEqual({ phase: "submitting", message: "Código detectado" });
    expect(harness.scanner.lock).toHaveBeenCalledOnce();
    resolve(success());
    await vi.waitFor(() => expect(harness.scanner.stop).toHaveBeenCalledOnce());
  });

  it("shows an invalid-code prompt and resumes without restarting the camera", async () => {
    vi.useFakeTimers();
    const harness = setup();
    await harness.controller.start();
    harness.decode("HELLO_ATTENDANCE");
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["raw_detected", "unrecognized"]);
    expect(harness.states).toContainEqual({ phase: "detected", message: "QR DETECTADO" });
    expect(harness.states.at(-1)?.message).toBe("Código no reconocido");
    expect(harness.states.at(-1)?.phase).toBe("transient_error");
    await vi.advanceTimersByTimeAsync(700);
    expect(harness.states.at(-1)?.phase).toBe("scanning");
    expect(harness.scanner.start).toHaveBeenCalledOnce();
    expect(harness.scanner.stop).not.toHaveBeenCalled();
    expect(harness.scanner.unlock).toHaveBeenCalledOnce();
  });

  it("automatically resumes after an expired QR without restarting the camera", async () => {
    vi.useFakeTimers();
    const submit = vi.fn<(value: string) => Promise<ScanAttendanceResult>>().mockResolvedValue({
      ok: false,
      code: "TOKEN_EXPIRED",
      message: "Expired",
    });
    const harness = setup(submit);
    await harness.controller.start();
    harness.decode(qrValue);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.states.at(-1)?.phase).toBe("transient_error");
    expect(harness.states.at(-1)?.message).toBe("El código cambió. Enfoca el nuevo código.");
    await vi.advanceTimersByTimeAsync(900);
    expect(harness.states.at(-1)?.phase).toBe("scanning");
    expect(harness.scanner.start).toHaveBeenCalledOnce();
    expect(harness.scanner.stop).not.toHaveBeenCalled();
  });

  it("stops on duplicate success and destroys resources on cleanup", async () => {
    const harness = setup(vi.fn().mockResolvedValue(success("already_registered")));
    await harness.controller.start();
    harness.decode(qrValue);
    await vi.waitFor(() => expect(harness.onSuccess).toHaveBeenCalled());
    expect(harness.scanner.stop).toHaveBeenCalledOnce();
    harness.controller.destroy();
    expect(harness.scanner.destroy).toHaveBeenCalledOnce();
  });

  it("shows the server class error instead of a generic scanner failure", async () => {
    const harness = setup(vi.fn().mockResolvedValue({
      ok: false,
      code: "CLASS_NOT_FOUND",
      message: "No pudimos identificar la clase.",
    }));
    await harness.controller.start();
    harness.decode(qrValue);
    await vi.waitFor(() => expect(harness.states.at(-1)).toEqual({
      phase: "error",
      message: "No pudimos identificar la clase.",
    }));
    expect(harness.scanner.stop).toHaveBeenCalledOnce();
  });
});

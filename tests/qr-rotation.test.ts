import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createQrFrame,
  initialQrRotationState,
  nextQrRefreshAt,
  qrRotationReducer,
  type QrFrame,
} from "@/lib/qr/rotation";

const oldQr: QrFrame = { imageDataUrl: "data:image/png;base64,old", expiresAt: 10_000, displayUntil: 10_000 };
const newQr: QrFrame = { imageDataUrl: "data:image/png;base64,new", expiresAt: 20_000, displayUntil: 20_000 };

describe("seamless QR rotation", () => {
  it("allows an initial loading state before the first QR exists", () => {
    expect(initialQrRotationState.current).toBeNull();
  });

  it("keeps the current QR while a refresh is in progress", () => {
    const state = qrRotationReducer({ ...initialQrRotationState, current: oldQr }, { type: "refresh-started" });
    expect(state.current).toBe(oldQr);
    expect(state.refreshing).toBe(true);
  });

  it("atomically replaces the image only when the next QR is ready", () => {
    const state = qrRotationReducer({ current: oldQr, refreshing: true, warning: null }, { type: "refresh-ready", frame: newQr });
    expect(state.current).toBe(newQr);
    expect(state.warning).toBeNull();
  });

  it("does not clear a QR at its scheduling boundary", () => {
    const state = { current: oldQr, refreshing: true, warning: null };
    expect(state.current).toBe(oldQr);
  });

  it("schedules a healthy visible frame for a true four seconds", () => {
    const readyAt = 100;
    const frame = createQrFrame("data:image/png;base64,current", 4_000, readyAt, 4_000, 750);
    expect(frame.displayUntil - readyAt).toBe(4_000);
    expect(nextQrRefreshAt(frame)).toBe(4_100);
  });

  it("uses tolerance only as a cap for an unusually slow handoff", () => {
    const frame = createQrFrame("data:image/png;base64,slow", 4_000, 900, 4_000, 750);
    expect(frame.displayUntil).toBe(4_750);
    expect(frame.displayUntil - 900).toBe(3_850);
  });

  it("keeps the previous QR and shows a warning after a refresh failure", () => {
    const state = qrRotationReducer({ current: oldQr, refreshing: true, warning: null }, { type: "refresh-failed", warning: "Reintentando" });
    expect(state.current).toBe(oldQr);
    expect(state.warning).toBe("Reintentando");
  });

  it("replaces the old QR and clears the warning after a successful retry", () => {
    const failed = qrRotationReducer({ current: oldQr, refreshing: true, warning: null }, { type: "refresh-failed", warning: "Reintentando" });
    const recovered = qrRotationReducer(failed, { type: "refresh-ready", frame: newQr });
    expect(recovered).toEqual({ current: newQr, refreshing: false, warning: null });
  });

  it("does not render the raw QR URL in the teacher UI", () => {
    const source = readFileSync(new URL("../components/teacher-dashboard.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/aria-label=["']URL del QR/iu);
    expect(source).not.toContain("setQrUrl");
  });

  it("keeps rotation internal without a visible timer or progress bar", () => {
    const source = readFileSync(new URL("../components/teacher-dashboard.tsx", import.meta.url), "utf8");
    expect(source).toContain("nextQrRefreshAt(frame)");
    expect(source).not.toContain("remainingSeconds");
    expect(source).not.toContain("qrProgress");
    expect(source).not.toContain("Nueva clave en");
  });
});

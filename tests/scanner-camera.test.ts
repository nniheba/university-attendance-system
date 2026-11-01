import { describe, expect, it, vi } from "vitest";

import { prepareScannerCamera } from "@/lib/attendance/scanner-camera";

describe("scanner camera preparation", () => {
  it("requests ideal HD quality and supported continuous autofocus", async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const info = await prepareScannerCamera({
      label: "Back Camera",
      getCapabilities: () => ({ focusMode: ["manual", "continuous"] }) as MediaTrackCapabilities,
      getSettings: () => ({ width: 1_920, height: 1_080, facingMode: "environment", deviceId: "present" }),
      applyConstraints,
    });
    expect(applyConstraints).toHaveBeenNthCalledWith(1, {
      width: { ideal: 1_920 },
      height: { ideal: 1_080 },
    });
    expect(applyConstraints).toHaveBeenNthCalledWith(2, {
      advanced: [{ focusMode: "continuous" }],
    });
    expect(info).toEqual({
      width: 1_920,
      height: 1_080,
      facingMode: "environment",
      deviceIdPresent: true,
      cameraLabel: "Back Camera",
      continuousFocus: true,
    });
  });

  it("does not send unsupported focus constraints or block startup", async () => {
    const applyConstraints = vi.fn().mockRejectedValueOnce(new Error("quality unsupported"));
    const info = await prepareScannerCamera({
      getCapabilities: () => ({ focusMode: ["manual"] }) as MediaTrackCapabilities,
      getSettings: () => ({ width: 1_280, height: 720 }),
      applyConstraints,
    });
    expect(applyConstraints).toHaveBeenCalledOnce();
    expect(info.continuousFocus).toBe(false);
    expect(info.width).toBe(1_280);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDelayedDecoderFallback,
  ZXING_FALLBACK_DELAY_MS,
  type FallbackDecoderStart,
} from "@/lib/attendance/zxing-fallback";

afterEach(() => {
  vi.useRealTimers();
});

describe("delayed ZXing scanner fallback", () => {
  it("starts after the primary decoder grace period using the same video element", async () => {
    vi.useFakeTimers();
    const video = {} as HTMLVideoElement;
    const stop = vi.fn();
    let fallbackDecode: ((value: string) => void) | null = null;
    const startDecoder = vi.fn<FallbackDecoderStart>().mockImplementation(async (receivedVideo, onDecode) => {
      expect(receivedVideo).toBe(video);
      fallbackDecode = onDecode;
      return { stop };
    });
    const onDecode = vi.fn();
    const states: string[] = [];
    const fallback = createDelayedDecoderFallback({
      video,
      onDecode,
      onState: (state) => states.push(state),
      startDecoder,
    });

    fallback.schedule();
    await vi.advanceTimersByTimeAsync(ZXING_FALLBACK_DELAY_MS - 1);
    expect(startDecoder).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(startDecoder).toHaveBeenCalledOnce();
    fallbackDecode!("HELLO_ATTENDANCE");
    expect(onDecode).toHaveBeenCalledWith("HELLO_ATTENDANCE");
    expect(states).toEqual(["waiting", "starting", "active"]);
  });

  it("locks the fallback after detection and restarts it after scanner recovery", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const startDecoder = vi.fn<FallbackDecoderStart>().mockResolvedValue({ stop });
    const fallback = createDelayedDecoderFallback({
      video: {} as HTMLVideoElement,
      onDecode: vi.fn(),
      startDecoder,
    });

    fallback.schedule();
    await vi.advanceTimersByTimeAsync(ZXING_FALLBACK_DELAY_MS);
    fallback.lock();
    expect(stop).toHaveBeenCalledOnce();
    fallback.unlock();
    await vi.advanceTimersByTimeAsync(ZXING_FALLBACK_DELAY_MS);
    expect(startDecoder).toHaveBeenCalledTimes(2);
  });

  it("cancels delayed activation when the scanner is destroyed", async () => {
    vi.useFakeTimers();
    const startDecoder = vi.fn<FallbackDecoderStart>();
    const fallback = createDelayedDecoderFallback({
      video: {} as HTMLVideoElement,
      onDecode: vi.fn(),
      startDecoder,
    });
    fallback.schedule();
    fallback.destroy();
    await vi.advanceTimersByTimeAsync(ZXING_FALLBACK_DELAY_MS);
    expect(startDecoder).not.toHaveBeenCalled();
  });
});

export type FallbackDecoderState = "idle" | "waiting" | "starting" | "active" | "locked" | "failed";

export interface FallbackDecoderControls {
  stop(): void;
}

export type FallbackDecoderStart = (
  video: HTMLVideoElement,
  onDecode: (value: string) => void,
) => Promise<FallbackDecoderControls>;

interface DelayedFallbackOptions {
  video: HTMLVideoElement;
  onDecode: (value: string) => void;
  onState?: (state: FallbackDecoderState) => void;
  startDecoder?: FallbackDecoderStart;
  delayMs?: number;
  setTimer?: typeof globalThis.setTimeout;
  clearTimer?: typeof globalThis.clearTimeout;
}

export interface DelayedDecoderFallback {
  schedule(): void;
  lock(): void;
  unlock(): void;
  stop(): void;
  destroy(): void;
}

export const ZXING_FALLBACK_DELAY_MS = 1_200;

export async function startZxingVideoDecoder(
  video: HTMLVideoElement,
  onDecode: (value: string) => void,
): Promise<FallbackDecoderControls> {
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: 320,
    delayBetweenScanSuccess: 500,
    tryPlayVideoTimeout: 3_000,
  });
  return reader.decodeFromVideoElement(video, (result) => {
    if (result) onDecode(result.getText());
  });
}

export function createDelayedDecoderFallback({
  video,
  onDecode,
  onState = () => undefined,
  startDecoder = startZxingVideoDecoder,
  delayMs = ZXING_FALLBACK_DELAY_MS,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
}: DelayedFallbackOptions): DelayedDecoderFallback {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let controls: FallbackDecoderControls | null = null;
  let generation = 0;
  let locked = false;
  let destroyed = false;

  function clearActivationTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function stopDecoder() {
    controls?.stop();
    controls = null;
  }

  async function activate(expectedGeneration: number) {
    timer = null;
    if (destroyed || locked || expectedGeneration !== generation) return;
    onState("starting");
    try {
      const nextControls = await startDecoder(video, (value) => {
        if (!destroyed && !locked && expectedGeneration === generation) onDecode(value);
      });
      if (destroyed || locked || expectedGeneration !== generation) {
        nextControls.stop();
        return;
      }
      controls = nextControls;
      onState("active");
    } catch {
      if (!destroyed && !locked && expectedGeneration === generation) onState("failed");
    }
  }

  function schedule() {
    if (destroyed || locked || timer !== null || controls) return;
    const expectedGeneration = generation;
    onState("waiting");
    timer = setTimer(() => void activate(expectedGeneration), delayMs);
  }

  function lock() {
    locked = true;
    generation += 1;
    clearActivationTimer();
    stopDecoder();
    if (!destroyed) onState("locked");
  }

  return {
    schedule,
    lock,
    unlock() {
      if (destroyed) return;
      locked = false;
      schedule();
    },
    stop() {
      lock();
    },
    destroy() {
      destroyed = true;
      generation += 1;
      clearActivationTimer();
      stopDecoder();
      onState("idle");
    },
  };
}

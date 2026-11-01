export interface QrFrame {
  imageDataUrl: string;
  expiresAt: number;
  displayUntil: number;
}

export interface QrRotationState {
  current: QrFrame | null;
  refreshing: boolean;
  warning: string | null;
}

export type QrRotationAction =
  | { type: "reset" }
  | { type: "refresh-started" }
  | { type: "refresh-ready"; frame: QrFrame }
  | { type: "refresh-failed"; warning: string };

export const initialQrRotationState: QrRotationState = {
  current: null,
  refreshing: false,
  warning: null,
};

export function createQrFrame(
  imageDataUrl: string,
  expiresAt: number,
  readyAt: number,
  lifetimeMs: number,
  toleranceMs: number,
): QrFrame {
  return {
    imageDataUrl,
    expiresAt,
    // A healthy frame receives its full visible lifetime. The cryptographic
    // grace remains a hard cap when generation itself was unusually slow.
    displayUntil: Math.min(readyAt + lifetimeMs, expiresAt + toleranceMs),
  };
}

export function nextQrRefreshAt(frame: QrFrame): number {
  return frame.displayUntil;
}

export function qrRotationReducer(
  state: QrRotationState,
  action: QrRotationAction,
): QrRotationState {
  switch (action.type) {
    case "reset":
      return initialQrRotationState;
    case "refresh-started":
      return { ...state, refreshing: true };
    case "refresh-ready":
      return { current: action.frame, refreshing: false, warning: null };
    case "refresh-failed":
      return { ...state, refreshing: false, warning: action.warning };
  }
}

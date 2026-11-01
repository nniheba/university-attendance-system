import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import QRCode from "qrcode";

export interface QrImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface WorkerMessage {
  id: number;
  type: string;
  data: string | null;
}

let decoderSource: string | null = null;

function loadDecoderSource(): string {
  if (decoderSource) return decoderSource;
  const moduleSource = readFileSync(
    new URL("../../node_modules/qr-scanner/qr-scanner-worker.min.js", import.meta.url),
    "utf8",
  );
  let captured = "";
  class CapturingBlob {
    constructor(parts: unknown[]) {
      captured = String(parts[0] ?? "");
    }
  }
  class CapturingWorker {
    constructor() {}
  }
  const context = {
    Blob: CapturingBlob,
    Worker: CapturingWorker,
    URL: { createObjectURL: () => "blob:test" },
  };
  runInNewContext(
    moduleSource.replace("export const createWorker=", "globalThis.createWorker="),
    context,
  );
  const createWorker = (context as typeof context & { createWorker?: () => unknown }).createWorker;
  if (!createWorker) throw new Error("Could not load qr-scanner worker.");
  createWorker();
  if (!captured) throw new Error("Could not capture qr-scanner decoder source.");
  decoderSource = captured;
  return captured;
}

export function qrModuleVersion(value: string): { modules: number; version: number } {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  return { modules: qr.modules.size, version: qr.version };
}

export function renderQrImage(value: string, width: number): QrImageData {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const margin = 3;
  const logicalSize = qr.modules.size + margin * 2;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    const row = Math.floor(y * logicalSize / width) - margin;
    for (let x = 0; x < width; x += 1) {
      const column = Math.floor(x * logicalSize / width) - margin;
      const dark = row >= 0 && row < qr.modules.size && column >= 0 && column < qr.modules.size
        ? qr.modules.get(row, column) === 1
        : false;
      const offset = (y * width + x) * 4;
      const channel = dark ? 0 : 255;
      data[offset] = channel;
      data[offset + 1] = channel;
      data[offset + 2] = channel;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height: width };
}

export function slightlyBlurred(image: QrImageData): QrImageData {
  const output = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let total = 0;
      let samples = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sourceX = Math.max(0, Math.min(image.width - 1, x + offsetX));
          const sourceY = Math.max(0, Math.min(image.height - 1, y + offsetY));
          total += image.data[(sourceY * image.width + sourceX) * 4];
          samples += 1;
        }
      }
      const channel = Math.round(total / samples);
      const target = (y * image.width + x) * 4;
      output[target] = channel;
      output[target + 1] = channel;
      output[target + 2] = channel;
      output[target + 3] = 255;
    }
  }
  return { ...image, data: output };
}

export function decodeWithQrScanner(image: QrImageData): string | null {
  const responses: WorkerMessage[] = [];
  const self = {
    postMessage(message: WorkerMessage) {
      responses.push(message);
    },
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
  };
  runInNewContext(loadDecoderSource(), {
    self,
    Uint8ClampedArray,
    Uint8Array,
    Int32Array,
    Math,
  });
  if (!self.onmessage) throw new Error("qr-scanner worker did not initialize.");
  self.onmessage({
    data: {
      id: 1,
      type: "decode",
      data: image,
    },
  });
  const response = responses.at(-1);
  return response?.type === "qrResult" ? response.data : null;
}

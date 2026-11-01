import { parseAttendanceQrValue } from "@/lib/qr/attendance-value";

export interface ScanAttendanceSuccess {
  ok: true;
  status: "registered" | "already_registered";
  enrolled: boolean;
  session: {
    id: string;
  };
  attendance: {
    id: string;
    full_name: string;
    registered_at: string;
  };
  class: {
    id: string;
    name: string;
    teacher_name: string;
  };
}

export interface ScanAttendanceFailure {
  ok: false;
  code: string;
  message: string;
}

export type ScanAttendanceResult = ScanAttendanceSuccess | ScanAttendanceFailure;

export interface OptionalScanLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function extractAttendanceToken(value: string, trustedOrigins: readonly string[] = []): string | null {
  return parseAttendanceQrValue(value, {
    trustedOrigins,
    allowLegacyRawToken: true,
  })?.token ?? null;
}

export async function submitAttendanceToken(
  token: string,
  location?: OptionalScanLocation,
): Promise<ScanAttendanceResult> {
  const response = await fetch("/api/attendance/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...(location ? { location } : {}) }),
  });
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") {
    return { ok: false, code: "INVALID_RESPONSE", message: "La respuesta del servidor no es válida." };
  }
  if (!response.ok) {
    const error = body as Partial<ScanAttendanceFailure>;
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : "SERVER_ERROR",
      message: typeof error.message === "string" ? error.message : "No se pudo registrar la asistencia.",
    };
  }
  return body as ScanAttendanceSuccess;
}

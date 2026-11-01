const COMPACT_TOKEN_PATTERN = /^q2\.[A-Za-z0-9_-]{22}\.[0-9a-z]{8,10}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/u;
const LEGACY_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const LEGACY_ATTENDANCE_PREFIX = "attendance:";
const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export interface ParsedAttendanceQrValue {
  token: string;
}

export interface AttendanceQrParseOptions {
  trustedOrigins: readonly string[];
  allowLegacyRawToken?: boolean;
}

function isAttendanceToken(value: string): boolean {
  return COMPACT_TOKEN_PATTERN.test(value) || LEGACY_TOKEN_PATTERN.test(value);
}

function normalizedWebOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return WEB_PROTOCOLS.has(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function attendanceQrUrl(origin: string, token: string): string {
  if (!isAttendanceToken(token)) throw new Error("Invalid attendance token format.");
  const normalizedOrigin = normalizedWebOrigin(origin);
  if (!normalizedOrigin) throw new Error("Invalid application origin.");
  return new URL(`/attendance/${encodeURIComponent(token)}`, normalizedOrigin).toString();
}

export function attendanceQrTrustedOrigins(
  currentOrigin: string,
  configuredOrigin = process.env.NEXT_PUBLIC_APP_URL,
): string[] {
  const origins = [currentOrigin, configuredOrigin]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizedWebOrigin)
    .filter((value): value is string => value !== null);
  return [...new Set(origins)];
}

export function parseAttendanceQrValue(
  value: string,
  options: AttendanceQrParseOptions,
): ParsedAttendanceQrValue | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (options.allowLegacyRawToken) {
    const raw = trimmed.startsWith(LEGACY_ATTENDANCE_PREFIX)
      ? trimmed.slice(LEGACY_ATTENDANCE_PREFIX.length)
      : trimmed;
    if (isAttendanceToken(raw)) return { token: raw };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    !WEB_PROTOCOLS.has(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) return null;

  const trustedOrigins = new Set(
    options.trustedOrigins
      .map(normalizedWebOrigin)
      .filter((origin): origin is string => origin !== null),
  );
  if (!trustedOrigins.has(url.origin)) return null;

  const match = url.pathname.match(/^\/attendance\/([^/]+)\/?$/u);
  if (!match) return null;
  try {
    const token = decodeURIComponent(match[1]);
    return isAttendanceToken(token) ? { token } : null;
  } catch {
    return null;
  }
}

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

function webOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return WEB_PROTOCOLS.has(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function applicationOrigin(
  requestUrl: string,
  configuredOrigin = process.env.NEXT_PUBLIC_APP_URL,
): string {
  const configured = webOrigin(configuredOrigin);
  if (configured) return configured;

  const requestOrigin = webOrigin(requestUrl);
  if (!requestOrigin) throw new Error("No se pudo determinar el origen de la aplicación.");
  return requestOrigin;
}

import { coarseText, countryCode, unknownLocation, type CoarseLocation } from "./coarse";

export type NetworkLocationStatus = "consistent" | "mismatch" | "unknown";

export function networkLocation(headers: Headers): CoarseLocation {
  // Only trust platform-added metadata when actually running on Vercel.
  if (process.env.VERCEL !== "1") return unknownLocation();
  const decode = (name: string) => {
    try { return coarseText(decodeURIComponent(headers.get(name) ?? "")); }
    catch { return null; }
  };
  const code = countryCode(headers.get("x-vercel-ip-country"));
  return {
    city: decode("x-vercel-ip-city"),
    region: decode("x-vercel-ip-country-region"),
    country: code ? new Intl.DisplayNames(["es"], { type: "region" }).of(code) ?? code : null,
    countryCode: code,
  };
}

export function compareNetworkCountry(sessionCountry: unknown, networkCountry: unknown): NetworkLocationStatus {
  const session = countryCode(sessionCountry);
  const network = countryCode(networkCountry);
  if (!session || !network) return "unknown";
  return session === network ? "consistent" : "mismatch";
}

import "server-only";
import { areValidCoordinates, type Coordinates } from "./distance";
import { coarseText, countryCode, unknownLocation, type CoarseLocation } from "./coarse";

export const GEOCODING_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_LIMIT = 100;

export interface ReverseGeocoder {
  lookup(center: Coordinates, signal: AbortSignal): Promise<CoarseLocation>;
}

export const geoapifyProvider: ReverseGeocoder = {
  async lookup(center, signal) {
    const key = process.env.GEOAPIFY_API_KEY;
    if (!key) return unknownLocation();
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.search = new URLSearchParams({
      lat: String(center.latitude), lon: String(center.longitude),
      type: "city", format: "json", lang: "es", limit: "1", apiKey: key,
    }).toString();
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) return unknownLocation();
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) return unknownLocation();
    const row: unknown = body.results[0];
    if (!row || typeof row !== "object") return unknownLocation();
    return {
      city: coarseText("city" in row ? row.city : null),
      region: coarseText("state" in row ? row.state : null),
      country: coarseText("country" in row ? row.country : null),
      countryCode: countryCode("country_code" in row ? row.country_code : null),
    };
  },
};

export function createSessionGeocoder(provider: ReverseGeocoder) {
  const cache = new Map<string, { expires: number; result: Promise<CoarseLocation> }>();
  return async (center: Coordinates): Promise<CoarseLocation> => {
    if (!areValidCoordinates(center)) return unknownLocation();
    const key = `${center.latitude},${center.longitude}`;
    const entry = cache.get(key);
    if (entry && entry.expires > Date.now()) return entry.result;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<CoarseLocation>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(unknownLocation()); }, GEOCODING_TIMEOUT_MS);
    });
    const result = Promise.race([
      Promise.resolve().then(() => provider.lookup(center, controller.signal)), timeout,
    ]).catch(() => unknownLocation()).finally(() => clearTimeout(timer));
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
    return result;
  };
}

// Called only during session creation, never with a student's reading.
export const reverseGeocodeSessionCenter = createSessionGeocoder(geoapifyProvider);

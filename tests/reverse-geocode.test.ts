import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionGeocoder, geoapifyProvider, GEOCODING_TIMEOUT_MS } from "@/lib/geolocation/reverse-geocode";
import { unknownLocation, type CoarseLocation } from "@/lib/geolocation/coarse";

const center = { latitude: 43.47, longitude: -3.8 };
const place = { city: "Madrid", region: "Comunidad de Madrid", country: "España", countryCode: "ES" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("session-center geocoding", () => {
  it("caches and shares concurrent lookups of the same center", async () => {
    const lookup = vi.fn().mockResolvedValue(place);
    const geocode = createSessionGeocoder({ lookup });
    expect(await Promise.all([geocode(center), geocode(center)])).toEqual([place, place]);
    await geocode(center);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(center, expect.any(AbortSignal));
  });
  it("fails open on provider error", async () => {
    const geocode = createSessionGeocoder({ lookup: async () => { throw new Error("offline"); } });
    expect(await geocode(center)).toEqual(unknownLocation());
  });
  it("aborts a slow provider after 2 seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const geocode = createSessionGeocoder({ lookup: (_center, abort) => { signal = abort; return new Promise<CoarseLocation>(() => {}); } });
    const result = geocode(center);
    await vi.advanceTimersByTimeAsync(GEOCODING_TIMEOUT_MS);
    expect(await result).toEqual(unknownLocation());
    expect(signal?.aborted).toBe(true);
  });
  it("makes no external request without credentials", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await geoapifyProvider.lookup(center, new AbortController().signal)).toEqual(unknownLocation());
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps only city/region/country from a session lookup", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "test-only-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [{ city: "Madrid", state: "Comunidad de Madrid", country: "España", country_code: "es", street: "ignored", lat: 43.47 }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await geoapifyProvider.lookup(center, new AbortController().signal)).toEqual(place);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("lat")).toBe(String(center.latitude));
    expect(url.searchParams.get("type")).toBe("city");
  });
});

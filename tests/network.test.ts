import { afterEach, describe, expect, it, vi } from "vitest";
import { compareNetworkCountry, networkLocation } from "@/lib/geolocation/network";

afterEach(() => vi.unstubAllEnvs());
describe("coarse network location", () => {
  it.each([["ES", "ES", "consistent"], ["ES", "CA", "mismatch"], ["ES", null, "unknown"], [null, "ES", "unknown"], ["es", "ES", "consistent"], ["ES", "XX", "unknown"]])("compares %s with %s", (a, b, status) => {
    expect(compareNetworkCountry(a, b)).toBe(status);
  });
  it("ignores platform-looking headers locally", () => {
    vi.stubEnv("VERCEL", "");
    expect(networkLocation(new Headers({ "x-vercel-ip-country": "CA" })).countryCode).toBeNull();
  });
  it("handles missing headers and extracts only coarse platform fields", () => {
    vi.stubEnv("VERCEL", "1");
    expect(networkLocation(new Headers()).countryCode).toBeNull();
    const place = networkLocation(new Headers({ "x-vercel-ip-country": "CA", "x-vercel-ip-city": "Montr%C3%A9al", "x-vercel-ip-country-region": "QC", "x-forwarded-for": "192.0.2.1" }));
    expect(place).toEqual({ city: "Montréal", region: "QC", country: "Canadá", countryCode: "CA" });
    expect(JSON.stringify(place)).not.toContain("192.0.2.1");
  });
});

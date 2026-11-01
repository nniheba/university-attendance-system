import { describe, expect, it } from "vitest";
import { haversineDistanceMeters, verifyLocation, maximumLocationAccuracy } from "@/lib/geolocation/distance";
import { parseFiniteNumber } from "@/lib/http";

const classroom = { latitude: 43.4714, longitude: -3.8004 };

describe("geolocation verification", () => {
  it.each([[60, 30, true], [80, 30, false], [95, 2, true], [95, 10, false]])(
    "distance %s + accuracy %s is contained: %s", (distance, accuracy, allowed) => {
      const point = { latitude: (Number(distance) / 6371000) * 180 / Math.PI, longitude: 0 };
      const result = verifyLocation(point, { latitude: 0, longitude: 0 }, Number(accuracy), 100);
      expect(result.distanceM).toBeCloseTo(Number(distance), 6);
      expect(result.allowed).toBe(allowed);
    },
  );
  it("caps acceptable accuracy at min(50, radius/2)", () => {
    expect(maximumLocationAccuracy(100)).toBe(50);
    expect(maximumLocationAccuracy(40)).toBe(20);
    expect(verifyLocation(classroom, classroom, 21, 40).allowed).toBe(false);
    expect(verifyLocation(classroom, classroom, 51, 100).allowed).toBe(false);
    expect(verifyLocation(classroom, classroom, 20, 40).allowed).toBe(true);
  });
  it.each([{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }])("rejects invalid coordinates %s", (point) => {
    expect(verifyLocation(point, classroom, 10, 100).reason).toBe("invalid");
  });
  it.each([-1, Infinity, NaN])("rejects invalid accuracy %s", (accuracy) => {
    expect(verifyLocation(classroom, classroom, accuracy, 100).reason).toBe("invalid");
  });
  it("does not convert missing or blank coordinates to zero", () => {
    for (const value of [null, undefined, "", " ", true]) expect(parseFiniteNumber(value)).toBeNull();
  });
  it("calculates reasonable Haversine distances", () => {
    const oneDegreeAtEquator = haversineDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(oneDegreeAtEquator).toBeGreaterThan(111_000);
    expect(oneDegreeAtEquator).toBeLessThan(112_000);
  });

  it("accepts a precise location inside the radius", () => {
    const result = verifyLocation(
      { latitude: 43.47145, longitude: -3.8004 },
      classroom,
      12,
      100,
    );
    expect(result.allowed).toBe(true);
    expect(result.distanceM).toBeLessThan(10);
  });

  it("rejects a location outside the radius", () => {
    const result = verifyLocation(
      { latitude: 43.4814, longitude: -3.8004 },
      classroom,
      10,
      100,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("outside");
  });

  it("rejects clearly insufficient accuracy", () => {
    const result = verifyLocation(classroom, classroom, 250, 100);
    expect(result).toMatchObject({ allowed: false, reason: "insufficient_accuracy" });
  });
});

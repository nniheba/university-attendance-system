import { isPlainObject, parseFiniteNumber } from "@/lib/http";
import { areValidCoordinates, verifyLocation } from "@/lib/geolocation/distance";

export type GpsStatus =
  | "not_shared"
  | "shared"
  | "verified"
  | "outside"
  | "inaccurate"
  | "unavailable";

export interface LocationEvidence {
  status: GpsStatus;
  accuracy: number | null;
  distanceFromCenterM: number | null;
}

export interface SessionLocationReference {
  latitude: number | null;
  longitude: number | null;
  allowed_radius_m: number | null;
}

export function evaluateOptionalLocation(
  value: unknown,
  reference: SessionLocationReference,
): LocationEvidence {
  if (value === undefined || value === null) {
    return { status: "not_shared", accuracy: null, distanceFromCenterM: null };
  }
  if (!isPlainObject(value)) {
    return { status: "unavailable", accuracy: null, distanceFromCenterM: null };
  }
  const latitude = parseFiniteNumber(value.latitude);
  const longitude = parseFiniteNumber(value.longitude);
  const accuracy = parseFiniteNumber(value.accuracy);
  if (
    latitude === null
    || longitude === null
    || accuracy === null
    || accuracy < 0
    || !areValidCoordinates({ latitude, longitude })
  ) {
    return { status: "unavailable", accuracy: null, distanceFromCenterM: null };
  }

  if (
    reference.latitude === null
    || reference.longitude === null
    || reference.allowed_radius_m === null
  ) {
    return { status: "shared", accuracy, distanceFromCenterM: null };
  }

  const result = verifyLocation(
    { latitude, longitude },
    { latitude: reference.latitude, longitude: reference.longitude },
    accuracy,
    reference.allowed_radius_m,
  );
  if (result.reason === "allowed") {
    return { status: "verified", accuracy, distanceFromCenterM: result.distanceM };
  }
  if (result.reason === "outside") {
    return { status: "outside", accuracy, distanceFromCenterM: result.distanceM };
  }
  if (result.reason === "insufficient_accuracy") {
    return { status: "inaccurate", accuracy, distanceFromCenterM: result.distanceM };
  }
  return { status: "unavailable", accuracy: null, distanceFromCenterM: null };
}

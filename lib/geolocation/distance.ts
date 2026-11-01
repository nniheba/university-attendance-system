const EARTH_RADIUS_M = 6_371_000;
export const MAX_LOCATION_ACCURACY_M = 50;

export function maximumLocationAccuracy(radiusM: number): number {
  return Math.min(MAX_LOCATION_ACCURACY_M, radiusM / 2);
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationCheck {
  allowed: boolean;
  reason: "allowed" | "invalid" | "insufficient_accuracy" | "outside";
  distanceM: number | null;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function areValidCoordinates({ latitude, longitude }: Coordinates): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function haversineDistanceMeters(
  from: Coordinates,
  to: Coordinates,
): number {
  if (!areValidCoordinates(from) || !areValidCoordinates(to)) return Number.NaN;

  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function verifyLocation(
  student: Coordinates,
  center: Coordinates,
  accuracyM: number,
  allowedRadiusM: number,
): LocationCheck {
  if (
    !areValidCoordinates(student) ||
    !areValidCoordinates(center) ||
    !Number.isFinite(accuracyM) ||
    accuracyM < 0 ||
    !Number.isFinite(allowedRadiusM) ||
    allowedRadiusM <= 0
  ) {
    return { allowed: false, reason: "invalid", distanceM: null };
  }

  const maximumAccuracyM = maximumLocationAccuracy(allowedRadiusM);
  if (accuracyM > maximumAccuracyM) {
    return { allowed: false, reason: "insufficient_accuracy", distanceM: null };
  }

  const distanceM = haversineDistanceMeters(student, center);
  if (distanceM > allowedRadiusM) return { allowed: false, reason: "outside", distanceM };
  if (distanceM + accuracyM > allowedRadiusM) {
    return { allowed: false, reason: "insufficient_accuracy", distanceM };
  }
  return { allowed: true, reason: "allowed", distanceM };
}

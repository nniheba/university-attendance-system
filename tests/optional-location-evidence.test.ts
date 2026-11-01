import { describe, expect, it } from "vitest";

import { evaluateOptionalLocation } from "@/lib/geolocation/evidence";

const reference = { latitude: 43.471, longitude: -3.799, allowed_radius_m: 100 };

describe("optional GPS evidence", () => {
  it("accepts missing and malformed evidence without rejecting attendance", () => {
    expect(evaluateOptionalLocation(undefined, reference).status).toBe("not_shared");
    expect(evaluateOptionalLocation({ latitude: "bad" }, reference).status).toBe("unavailable");
  });

  it("marks shared coordinates when the session has no reference", () => {
    expect(evaluateOptionalLocation(
      { latitude: 43.471, longitude: -3.799, accuracy: 12 },
      { latitude: null, longitude: null, allowed_radius_m: null },
    )).toEqual({ status: "shared", accuracy: 12, distanceFromCenterM: null });
  });

  it("classifies compatible, outside and inaccurate evidence", () => {
    expect(evaluateOptionalLocation({ latitude: 43.471, longitude: -3.799, accuracy: 5 }, reference).status).toBe("verified");
    expect(evaluateOptionalLocation({ latitude: 43.48, longitude: -3.799, accuracy: 5 }, reference).status).toBe("outside");
    expect(evaluateOptionalLocation({ latitude: 43.471, longitude: -3.799, accuracy: 80 }, reference).status).toBe("inaccurate");
  });
});

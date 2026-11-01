import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Next.js security headers", () => {
  it("allows same-origin camera access while keeping microphone access disabled", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");

    const rules = await nextConfig.headers!();
    const globalRule = rules.find((rule) => rule.source === "/:path*");
    const permissionsPolicy = globalRule?.headers.find(
      (header) => header.key === "Permissions-Policy",
    )?.value;

    expect(permissionsPolicy).toBe(
      "geolocation=(self), camera=(self), microphone=()",
    );
    expect(permissionsPolicy).not.toContain("camera=()");
  });

  it("keeps clickjacking protection in the content security policy", async () => {
    const rules = await nextConfig.headers!();
    const globalRule = rules.find((rule) => rule.source === "/:path*");
    const contentSecurityPolicy = globalRule?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
  });
});

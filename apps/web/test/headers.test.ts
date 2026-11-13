import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.mjs";

describe("Security headers in next.config", () => {
  it("defines required security headers for all routes", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const headerConfigs = await nextConfig.headers!();
    expect(headerConfigs.length).toBeGreaterThan(0);

    const allRoutes = headerConfigs.find(
      (h: { source?: string; headers: Array<{ key: string; value: string }> }) =>
        h.source === "/:path*" || h.source === "/(.*)",
    );
    expect(allRoutes).toBeDefined();

    const headersMap = new Map(
      allRoutes!.headers.map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]),
    );

    // 1. Content-Security-Policy
    const csp = headersMap.get("content-security-policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");

    // 2. nosniff
    expect(headersMap.get("x-content-type-options")).toBe("nosniff");

    // 3. Referrer-Policy
    expect(headersMap.get("referrer-policy")).toBe("no-referrer");

    // 4. Permissions-Policy denying camera, microphone, geolocation
    const permissions = headersMap.get("permissions-policy");
    expect(permissions).toBeDefined();
    expect(permissions).toMatch(/camera=\(\)/);
    expect(permissions).toMatch(/microphone=\(\)/);
    expect(permissions).toMatch(/geolocation=\(\)/);
  });
});

import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export function createAuthMiddleware(expectedToken: string): MiddlewareHandler {
  if (!expectedToken || expectedToken.length < 16) {
    throw new Error("createAuthMiddleware: expectedToken must be at least 16 characters");
  }

  const expectedDigest = createHash("sha256").update(expectedToken).digest();

  return async (c: Context, next: () => Promise<void>) => {
    const authHeader = c.req.header("Authorization") ?? "";
    const match = /^Bearer (\S+)$/.exec(authHeader);

    if (!match) {
      return c.json(
        { error: "unauthorized", message: "A valid bearer token is required." },
        401
      );
    }

    const providedToken = match[1]!;
    const providedDigest = createHash("sha256").update(providedToken).digest();

    if (!timingSafeEqual(providedDigest, expectedDigest)) {
      return c.json(
        { error: "unauthorized", message: "Invalid bearer token." },
        401
      );
    }

    await next();
  };
}

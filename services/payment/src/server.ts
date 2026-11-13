import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { PayRequest, type PayResult } from "@shucamoxa/shared";
import type { PaymentService } from "./payment-service";

export interface PaymentServerOptions {
  callerToken: string;
  paymentService: PaymentService;
}

function verifyToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(a, b);
}

export function createPaymentServer(options: PaymentServerOptions): Hono {
  const app = new Hono();
  const { callerToken, paymentService } = options;

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/payments", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!verifyToken(authHeader, callerToken)) {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid or missing authorization token" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "BAD_REQUEST", message: "Malformed JSON body" }, 400);
    }

    const parseResult = PayRequest.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid PayRequest payload", details: parseResult.error.issues },
        400,
      );
    }

    try {
      const result: PayResult = await paymentService.pay(parseResult.data);
      return c.json(result, 200);
    } catch (err: any) {
      if (err?.status === 503) {
        return c.json({ error: "POLICY_UNAVAILABLE", message: err.message }, 503);
      }
      return c.json({ error: "INTERNAL_ERROR", message: err?.message ?? "Payment execution error" }, 500);
    }
  });

  return app;
}

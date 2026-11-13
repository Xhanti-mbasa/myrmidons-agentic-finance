import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Client } from "xrpl";
import { MemoryAuditLog } from "./audit";
import { loadPaymentConfig } from "./config";
import { PaymentService } from "./payment-service";
import { HttpPolicyClient } from "./policy-client";
import { createPaymentServer } from "./server";
import type { RulesStore } from "./types";

try {
  const envFile = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const config = loadPaymentConfig(process.env);
  const xrplClient = new Client(config.xrplWss);

  const policyClient = new HttpPolicyClient(config.policyUrl, config.policyCallerToken);
  const auditLog = new MemoryAuditLog();

  // Basic rules store provider (reads from configured suppliers or can be extended)
  const rulesStore: RulesStore = {
    getSupplier: async (_supplierId: string) => null,
  };

  const paymentService = new PaymentService({
    agentSeed: config.agentSeed,
    treasuryAccount: config.treasuryAccount,
    policyAccount: config.policyAccount,
    maxFeeDrops: config.maxFeeDrops,
    pollIntervalMs: config.pollIntervalMs,
    rulesStore,
    auditLog,
    policyClient,
    xrplClient,
  });

  const app = createPaymentServer({
    callerToken: config.paymentCallerToken,
    paymentService,
  });

  const server = serve(
    { fetch: app.fetch, hostname: config.host, port: config.port },
    () => console.log(JSON.stringify({ event: "listening", host: config.host, port: config.port })),
  );

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Payment service could not listen on ${config.host}:${config.port} (${error.code ?? "error"})`);
    process.exit(1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Payment service failed to start");
  process.exit(1);
}

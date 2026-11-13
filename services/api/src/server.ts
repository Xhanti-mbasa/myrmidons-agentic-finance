import { serve } from "@hono/node-server";
import { createDatabase } from "@shucamoxa/db";
import { createApp } from "./app";
import { loadApiConfig, type ApiServerConfig } from "./config";
import type { ApiDeps, PaymentRelayer } from "./types";

export interface ServerOptions {
  config?: ApiServerConfig;
  env?: Record<string, string | undefined>;
  paymentRelayer?: PaymentRelayer;
}

export function createApiServer(options: ServerOptions = {}) {
  const config = options.config ?? loadApiConfig(options.env);
  const db = createDatabase(config.dbPath);

  const deps: ApiDeps = {
    db,
    config,
    paymentRelayer: options.paymentRelayer,
  };

  const app = createApp(deps);

  return {
    app,
    db,
    config,
    listen: () => {
      const server = serve({
        fetch: app.fetch,
        port: config.port,
        hostname: config.host,
      });
      return server;
    },
  };
}

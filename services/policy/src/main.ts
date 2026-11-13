/** `pnpm --filter @shucamoxa/policy start`: policy service, on 127.0.0.1:8791 unless configured. */
import { serve } from "@hono/node-server";
import { createPolicyServer } from "./server";

try {
  const { app, host, port } = createPolicyServer({
    env: process.env,
  });
  const server = serve({ fetch: app.fetch, hostname: host, port }, () => {
    console.log(JSON.stringify({ event: "listening", host, port }));
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Policy service could not listen on ${host}:${port} (${error.code ?? "error"})`);
    process.exit(1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Policy service failed to start");
  process.exit(1);
}

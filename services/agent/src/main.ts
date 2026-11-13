/** `pnpm --filter @shucamoxa/agent start`: the agent HTTP service, on 127.0.0.1:8790 unless configured. */
import { serve } from "@hono/node-server";
import { agentStartupEnv } from "./config";
import { modelFromConfig } from "./model";
import { createAgentServer } from "./server";

try {
  const { app, host, port } = createAgentServer({
    env: agentStartupEnv(),
    models: (config) => {
      const model = modelFromConfig(config);
      return { extractionModel: model, plannerModel: model };
    },
  });
  const server = serve({ fetch: app.fetch, hostname: host, port }, () => console.log(JSON.stringify({ event: "listening", host, port })));
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Agent service could not listen on ${host}:${port} (${error.code ?? "error"})`);
    process.exit(1);
  });
} catch (error) {
  // Config errors name the variable and never echo its value (T09).
  console.error(error instanceof Error ? error.message : "Agent service failed to start");
  process.exit(1);
}

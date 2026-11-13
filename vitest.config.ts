import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/shared", "services/agent", "services/backend", "services/payments", "services/mock-backend", "scripts"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/db",
      "services/agent",
      "services/payments",
      "services/backend",
      "services/mock-backend",
      "services/api",
      "scripts",
    ],
  },
});

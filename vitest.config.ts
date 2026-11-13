import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "services/agent",
      "services/payments",
      "services/backend",
      "services/mock-backend",
      "scripts",
    ],
  },
});

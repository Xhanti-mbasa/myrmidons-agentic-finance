import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/.stryker-tmp/**", "**/node_modules/**", "**/dist/**"],
    projects: [
      "packages/shared",
      "packages/db",
      "services/agent",
      "services/payment",
      "services/payments",
      "services/backend",
      "services/mock-backend",
      "services/policy",
      "scripts",
    ],
  },
});

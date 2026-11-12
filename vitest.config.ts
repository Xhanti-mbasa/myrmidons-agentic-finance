import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/shared", "services/agent", "scripts"],
  },
});

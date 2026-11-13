import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/.stryker-tmp/**", "**/node_modules/**"],
  },
});

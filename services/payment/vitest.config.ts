import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "payment",
    include: ["test/**/*.test.ts"],
  },
});

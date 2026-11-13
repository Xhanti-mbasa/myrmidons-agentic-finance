import { defineProject } from "vitest/config";
export default defineProject({ test: { name: "payments", include: ["test/**/*.test.ts"] } });

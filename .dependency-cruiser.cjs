/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-agent-to-db",
      severity: "error",
      comment: "services/agent must not directly import or depend on packages/db",
      from: {
        path: "^services/agent",
      },
      to: {
        path: "^packages/db",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "./tsconfig.json",
    },
  },
};

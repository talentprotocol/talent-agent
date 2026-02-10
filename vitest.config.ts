import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "src/__mocks__/server-only.ts"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 30000,
    setupFiles: ["./src/test-setup.ts"],
  },
});

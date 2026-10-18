import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { setupFiles: ["./tests/setup.ts"], include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/src/**/*.test.tsx"], environment: "node" },
});

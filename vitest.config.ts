import { defineConfig } from "vitest/config";

// Standalone config for app unit tests (pure logic). Kept separate from
// vite.config.ts so the React Router plugin isn't loaded in tests. The
// discount function has its own vitest setup under extensions/upsell-discount.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});

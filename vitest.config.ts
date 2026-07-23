import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// W67 — vitest must not pick up real production secrets from .env.local.
// Previously this config did `dotenv.config({ path: ".env.local" })`, which
// meant any developer with a populated .env.local was running the test suite
// against live API keys, real DATABASE_URL, real JWT_SECRET, real KEK — a
// single accidental DB call from a test would hit production. Switch to a
// stub-only file (.env.test) that is checked into the repo with safe dummy
// values; if .env.test is absent we fall through with nothing loaded.
const envTestPath = path.resolve(__dirname, ".env.test");
if (fs.existsSync(envTestPath)) {
  dotenv.config({ path: envTestPath });
}

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/__tests__/ui/**", "happy-dom"],
    ],
    setupFiles: ["./src/__tests__/setup.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

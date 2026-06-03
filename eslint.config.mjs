import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslintParser from "@typescript-eslint/parser";
import tseslintPlugin from "@typescript-eslint/eslint-plugin";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**"]),

  // W23 — typed lint rules. Scoped narrowly so we can add a single
  // high-value rule (`no-floating-promises`) without committing to the
  // full `recommendedTypeChecked` set, which would surface hundreds of
  // pre-existing warnings and stall the security batch.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslintPlugin },
    rules: {
      // Catches `db.insert(...)` and similar awaitables that are silently
      // discarded — a common cause of "the write didn't happen" bugs.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
]);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/lib/database.types.ts",
  ]),
  // Decision #3 / brief §3: the service-role client may only be imported from
  // src/server/privileged/* (webhooks, workers, bank seeding).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/privileged/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/privileged/*", "**/server/privileged/*"],
              message:
                "Privileged (service-role) code may only be imported from src/server/privileged/*.",
            },
          ],
        },
      ],
    },
  },
]);

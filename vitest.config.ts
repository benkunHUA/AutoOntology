import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ao/protocol": src("protocol"),
      "@ao/api": src("api"),
      "@ao/core": src("core"),
      "@ao/tools": src("tools"),
      "@ao/skills": src("skills"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  dts: true,
  sourcemap: true,
  noExternal: ["@blind-turn/shared", "@blind-turn/game-engine"],
});

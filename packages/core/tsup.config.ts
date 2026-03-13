import { defineConfig } from "tsup";
import tsupconfig from "../tsup-config";

export default defineConfig({
  ...tsupconfig,
  external: [
    ...(tsupconfig.external ?? []),
    "convex",
    "convex/react",
    "convex/server",
  ],
});

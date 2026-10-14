import path from "path";
import { defineConfig } from "vitest/config";

// Lets tests import modules that use the app's "@/..." paths.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
});

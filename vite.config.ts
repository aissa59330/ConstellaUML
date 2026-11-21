import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [solid()],
  // Single source of the version shown in the app: package.json.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "safari15", sourcemap: true, chunkSizeWarningLimit: 2000 },
  test: { setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.ts"], environment: "node" },
});

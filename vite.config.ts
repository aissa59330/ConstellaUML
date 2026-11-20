import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "safari15", sourcemap: true, chunkSizeWarningLimit: 2000 },
  test: { setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.ts"], environment: "node" },
});

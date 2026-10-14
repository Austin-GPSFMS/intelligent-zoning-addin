import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the GPSFMS Intelligent Zoning MyGeotab add-in.
 *
 * Hosted at:
 *   https://austin-gpsfms.github.io/intelligent-zoning-addin/dist/index.html
 *
 * `base: ""` produces clean relative asset paths in the built index.html
 * (`<script src="assets/index-XXX.js">`) — same reasoning as
 * engine_hours_zone: absolute `/` paths get duplicated by MyGeotab's iframe
 * loader and `./` paths can 404 on GitHub Pages.
 */
export default defineConfig({
  base: "",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    assetsInlineLimit: 20480,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});

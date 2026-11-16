import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      // Manifest icons are added to the precache by the plugin itself.
      injectManifest: { globPatterns: ["**/*.{js,css,html,woff2}"], rollupFormat: "iife", maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
      devOptions: { enabled: false },
      manifest: {
        name: "旅程規劃",
        short_name: "旅程規劃",
        description: "離線也能用的旅程規劃工具",
        lang: "zh-Hant",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#1D4ED8",
        background_color: "#EEF2F7",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});

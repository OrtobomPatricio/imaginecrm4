import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const plugins = [
  react(),
  tailwindcss(),
  VitePWA({
    registerType: "autoUpdate",
    workbox: {
      globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          urlPattern: /^\/api\/trpc\//,
          handler: "NetworkOnly",
        },
        {
          urlPattern: /^\/api\/uploads\//,
          handler: "CacheFirst",
          options: {
            cacheName: "uploads-cache",
            expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
          },
        },
      ],
    },
    manifest: {
      name: "CRM PRO V4",
      short_name: "CRM PRO",
      description: "Sistema avanzado de gestión de clientes multicanal",
      theme_color: "#1e1e2e",
      background_color: "#1e1e2e",
      display: "standalone",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
  }),
];

// Bundle analyzer (run with ANALYZE=true npm run build)
if (process.env.ANALYZE === "true") {
  // @ts-ignore - optional dev dependency
  import("rollup-plugin-visualizer").then(({ visualizer }) => {
    plugins.push(visualizer({
      open: true,
      filename: "dist/bundle-report.html",
      gzipSize: true,
      brotliSize: true,
    }) as any);
  }).catch(() => { /* optional dependency */ });
}

export default defineConfig({
  plugins,
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "client", "src") },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@assets", replacement: path.resolve(import.meta.dirname, "attached_assets") },
    ],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: 'hidden',
  },
  server: {
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    fs: { strict: true, deny: ["**/.*"] },
  },
});

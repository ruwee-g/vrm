import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
const host = process.env.TAURI_DEV_HOST;
const devPort = Number(process.env.VITE_DEV_PORT ?? "1420");
const prerelease = process.env.VITE_CHANNEL === "prerelease";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    ...(prerelease
      ? [
          {
            name: "remove-builtin-vrm-prerelease",
            closeBundle() {
              fs.rmSync(new URL("./dist/vrm/model.vrm", import.meta.url), {
                force: true,
              });
              try {
                fs.rmdirSync(new URL("./dist/vrm", import.meta.url));
              } catch {
                // directory may already be gone
              }
            },
          },
        ]
      : []),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: devPort + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

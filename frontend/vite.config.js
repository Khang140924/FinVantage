import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const sharedRoot = fileURLToPath(new URL("../shared", import.meta.url));
const disableDotenv = process.env.FINVANTAGE_DISABLE_DOTENV === "true";
const authProxyTarget =
  process.env.FINVANTAGE_AUTH_PROXY_TARGET || "http://localhost:4000";

const productionEnvironmentGuard = () => ({
  name: "finvantage-production-environment-guard",
  configResolved(config) {
    if (config.command !== "build" || config.mode !== "production") return;
    const authMode = String(process.env.VITE_AUTH_MODE || config.env?.VITE_AUTH_MODE || "").trim();
    const apiBaseUrl = String(process.env.VITE_API_BASE_URL || config.env?.VITE_API_BASE_URL || "").trim();
    if (authMode !== "cognito") {
      throw new Error("Production build requires VITE_AUTH_MODE=cognito.");
    }
    let parsed;
    try {
      parsed = new URL(apiBaseUrl);
    } catch {
      throw new Error("Production build requires a valid VITE_API_BASE_URL.");
    }
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (
      parsed.protocol !== "https:"
      || localHost
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || /(?:placeholder|example\.invalid|replace(?:_|-)?me)/i.test(apiBaseUrl)
    ) {
      throw new Error("Production VITE_API_BASE_URL must be an explicit non-local HTTPS URL.");
    }
  },
});

export default defineConfig({
  envDir: disableDotenv ? false : undefined,
  plugins: [react(), productionEnvironmentGuard()],
  resolve: {
    alias: {
      "@shared": sharedRoot,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: {
      allow: [frontendRoot, sharedRoot],
    },
    proxy: {
      "/auth": {
        target: authProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts")) return "charts";
          if (id.includes("node_modules/react")) return "vendor";
        },
      },
    },
  },
});

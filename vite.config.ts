import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig(async ({ command, mode }) => {
  const plugins = [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
      server: { entry: "server" },
      serverFns: {
        disableCsrfMiddlewareWarning: true,
      },
    }),
    react(),
  ];

  if (command === "build") {
    try {
      const nitroMod = await import("nitro/vite");
      // ponytail: desktop mode uses node-server so Electron can spawn it directly
      const isDesktop = mode === "desktop";
      plugins.push(
        nitroMod.nitro(
          isDesktop
            ? {
                preset: "node-server",
                routeRules: {
                  "/**": {
                    headers: {
                      "Cross-Origin-Opener-Policy": "same-origin",
                      "Cross-Origin-Embedder-Policy": "require-corp",
                    },
                  },
                },
              }
            : { preset: "netlify" },
        ),
      );
    } catch (err) {
      console.warn("Failed to load nitro plugin:", err);
    }
  }

  // Load environment variables prefixed with VITE_
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define: envDefine,
    css: {
      transformer: "lightningcss",
    },
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "::",
      port: 8080,
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    preview: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    worker: {
      format: "es",
    },
    plugins,
  };
});

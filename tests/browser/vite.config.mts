import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { AVATAR_SEED_PATTERN, generateAvatarSvg, isAvatarStyle } from "../../src/lib/avatar/generate";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** Serves generated avatars at the same URL the app uses. */
function avatars(): Plugin {
  return {
    name: "foreman-test-avatars",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = request.url?.match(/^\/api\/avatar\/([a-z]+)\/([a-z0-9]+)$/);
        if (!match || !isAvatarStyle(match[1]) || !AVATAR_SEED_PATTERN.test(match[2])) return next();
        response.setHeader("Content-Type", "image/svg+xml");
        response.end(generateAvatarSvg(match[1], match[2]));
      });
    },
  };
}

/** Builds the board UI for browser tests, with Next.js-only modules replaced by small stand-ins. */
export default defineConfig({
  root: path("./harness"),
  plugins: [react(), tailwindcss(), avatars()],
  resolve: {
    alias: [
      { find: "next/link", replacement: path("./stubs/next-link.tsx") },
      { find: "next/navigation", replacement: path("./stubs/next-navigation.ts") },
      { find: "@/lib/auth/actions", replacement: path("./stubs/auth-actions.ts") },
      { find: "server-only", replacement: path("../support/empty-module.ts") },
      { find: "@", replacement: path("../../src") },
    ],
  },
  server: { port: 4317, strictPort: true, host: "127.0.0.1" },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/components": path.resolve(__dirname, "./src/components"),
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/services": path.resolve(__dirname, "./src/services"),
      "@/stores": path.resolve(__dirname, "./src/stores"),
      "@/types": path.resolve(__dirname, "./src/types"),
      "@/pages": path.resolve(__dirname, "./src/pages"),
    },
  },

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Reduce watcher pressure from generated/artifact directories in local dev.
      ignored: [
        "**/src-tauri/**",
        "**/dist/**",
        "**/dist-portable/**",
        "**/artifacts/**",
        "**/release/**",
        "**/design/**",
        "**/research_add_time/**",
      ],
    },
  },
}));

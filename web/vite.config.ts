import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: /api được chuyển tới `wrangler dev` (cổng 8787) → không cần cấu hình CORS khi chạy local.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787", "/health": "http://127.0.0.1:8787" } },
  build: { chunkSizeWarningLimit: 1500 },
});

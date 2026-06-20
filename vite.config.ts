import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen dual-stack (IPv6 ::1 + IPv4 127.0.0.1) so `localhost` always
    // resolves whether the browser prefers IPv6 or IPv4.
    host: "::",
    port: 5173,
    // When the SimpleFIN backend is added later, /api calls proxy to it.
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});

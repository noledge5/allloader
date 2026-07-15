import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build to web/dist (served by FastAPI). During dev, proxy the API + WS to the
// backend on :5100 so `npm run dev` works against a running Cove.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:5100", ws: true, changeOrigin: true },
    },
  },
});

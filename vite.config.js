import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: {
    host: true,
    https: true,
    port: 5173,
    strictPort: true
  }
});

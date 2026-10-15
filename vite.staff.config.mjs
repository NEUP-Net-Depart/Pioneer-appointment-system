import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    alias: [
      {
        find: /^\/shared\//,
        replacement: fileURLToPath(new URL("./shared/", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "dist/staff",
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    lib: {
      entry: "frontend/staff-react/main.jsx",
      formats: ["es"],
      fileName: () => "react-main.mjs",
      cssFileName: "field",
    },
    rolldownOptions: {
      external: [/^\/vendor\//],
      output: { chunkFileNames: "chunks/[name]-[hash].mjs" },
    },
  },
});

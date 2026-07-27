import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Frontend never talks to inference/MCP backends directly -- everything
      // goes through the Blombrain backend API. This proxy just avoids CORS
      // pain during `npm run dev`; in production the backend can also serve
      // the built frontend directly (see backend/src/server.ts).
      '/api': {
        target: 'http://localhost:4300',
        changeOrigin: true,
      },
    },
  },
})

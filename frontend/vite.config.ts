import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Ports are assigned per-project in ~/Documents/Projects/PORTS.md.
// strictPort makes a collision fail loudly instead of silently drifting
// to a port where the /api proxy no longer matches the backend.
// PORT env override is honored for preview tooling.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5250,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5251',
    },
  },
  preview: {
    port: 5255,
    strictPort: true,
  },
})

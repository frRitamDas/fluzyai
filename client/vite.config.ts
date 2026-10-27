import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const serverPort = env.PORT ?? process.env.PORT ?? 3001

  return {
    plugins: [react(), tailwindcss()],
    base: process.env.VITE_BASE ?? '/',
    envDir: path.resolve(__dirname, '..'),
    define: {
      __SERVER_PORT__: JSON.stringify(String(serverPort)),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      // Vite's default target tracks "widely available" and moves forward with
      // each release, which silently drops browsers that are still common on
      // phones: an older Safari or WebView cannot PARSE a bundle built for a
      // newer baseline, so the script never runs at all and the page stays
      // empty — indistinguishable from a black screen, with no error a visitor
      // can act on. Downgrading the syntax costs a little size and is the
      // difference between "shows an out-of-date page" and "shows nothing".
      target: ['es2019', 'chrome79', 'edge79', 'firefox72', 'safari13'],
    },
    server: {
      proxy: {
        // Force IPv4 — on Windows + Node 17+, `localhost` resolves to ::1 first,
        // which can collide with wslrelay / Docker Desktop listeners on the same port.
        '/api': `http://127.0.0.1:${serverPort}`,
        '/v1': `http://127.0.0.1:${serverPort}`,
      },
    },
  }
})

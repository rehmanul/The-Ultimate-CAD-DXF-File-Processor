import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  base: './',
  server: {
    port: 4000,
    open: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
});

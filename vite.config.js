import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  base: './',
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true }
    }
  }
});

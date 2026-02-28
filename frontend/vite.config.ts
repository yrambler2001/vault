import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    allowedHosts: true as const,
    host: true,
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
}));

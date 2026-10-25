import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors into cacheable chunks (UI_AUDIT plan #10).
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'charts';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'forms';
          if (id.includes('react-router') || id.includes('@tanstack') || id.includes('zustand')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
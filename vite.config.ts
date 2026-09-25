import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // DOCX support is loaded only when a document is imported and lives in a separate chunk.
      chunkSizeWarningLimit: 550,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // File watching can be disabled to prevent flickering during automated edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // avatar-service/ (entorno Python, modelos y MP4 generados) no forma parte del front:
      // vigilarlo saturaba el watcher y recargaba la página en mitad de un vídeo.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/avatar-service/**'] },
    },
  };
});

import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        auth: resolve(__dirname, 'src/pages/auth.html'),
        chat: resolve(__dirname, 'src/pages/chat.html'),
        settings: resolve(__dirname, 'src/pages/settings.html'),
      },
    },
  },
});

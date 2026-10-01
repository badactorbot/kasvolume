import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const rawPort = process.env.PORT;
  if (command === 'serve' && !rawPort) {
    throw new Error(
      'PORT environment variable is required when running the Vite server.',
    );
  }
  const port = rawPort ? Number(rawPort) : undefined;
  if (port !== undefined && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? (command === 'build' ? '/' : undefined);
  if (!basePath) {
    throw new Error(
      'BASE_PATH environment variable is required when running the Vite server.',
    );
  }

  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8080';

  return {
    base: basePath,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      // Same-origin /api in local dev — no Replit router, no separate proxy required.
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});

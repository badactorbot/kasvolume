import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const TESTNET_REST = 'https://api-tn10.kaspa.org';
const MAINNET_REST = 'https://api.kaspa.org';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.PORT || 5174);
  const network = env.VITE_KASPA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet-10';
  const restTarget = network === 'mainnet' ? MAINNET_REST : TESTNET_REST;
  const mintApi = env.VITE_MINT_API_URL || 'http://127.0.0.1:8112';

  return {
    plugins: [react()],
    server: {
      port,
      host: '0.0.0.0',
      strictPort: true,
      proxy: {
        '/api/kcc721': { target: mintApi, changeOrigin: true },
        '/kaspa-rest': {
          target: restTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/kaspa-rest/, ''),
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      proxy: {
        '/api/kcc721': { target: mintApi, changeOrigin: true },
        '/kaspa-rest': {
          target: restTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/kaspa-rest/, ''),
        },
      },
    },
  };
});

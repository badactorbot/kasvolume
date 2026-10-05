/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MINT_MODE?: 'fixture' | 'live';
  readonly VITE_MINT_API_URL?: string;
  readonly VITE_KASPA_NETWORK?: 'testnet-10' | 'mainnet';
  readonly VITE_COLLECTION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installFixtureWallet, wantsFixtureWallet } from './lib/fixture-wallet';
import { mintMode } from './lib/network';
import { readScene } from './lib/scene';
import './index.css';

if (mintMode() === 'fixture' && wantsFixtureWallet()) {
  installFixtureWallet(readScene());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

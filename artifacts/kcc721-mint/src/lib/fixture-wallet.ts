import type { MintScene } from './scene';
import { sceneWantsWallet } from './scene';
import { mintMode } from './network';
import {
  FIXTURE_PUBLIC_KEY,
  FIXTURE_WALLET_ADDRESS,
} from './ids';
import { extractKaswareTransactionId, type KaswareProvider } from './kasware';

export function wantsFixtureWallet(search = window.location.search): boolean {
  if (mintMode() !== 'fixture') return false;
  const params = new URLSearchParams(search);
  const scene = params.get('scene') as MintScene | null;
  const fixtureWallet = params.get('fixtureWallet') === '1';
  return sceneWantsWallet(scene, fixtureWallet);
}

export function installFixtureWallet(scene: MintScene | null): void {
  if (window.kasware) return;
  const rejected = scene === 'rejected';
  const confirmed = scene === 'insufficient' ? '40000000' : '4200000000';
  const provider: KaswareProvider = {
    async getAccounts() {
      return [FIXTURE_WALLET_ADDRESS];
    },
    async requestAccounts() {
      return [FIXTURE_WALLET_ADDRESS];
    },
    async getPublicKey() {
      return FIXTURE_PUBLIC_KEY;
    },
    async getNetwork() {
      return scene === 'wrong-network' ? 'kaspa_mainnet' : 'kaspa_testnet_10';
    },
    async getBalance() {
      return {
        confirmed,
        unconfirmed: '9000000000',
        total: (BigInt(confirmed) + 9_000_000_000n).toString(),
      };
    },
    async signPskt(input) {
      if (rejected) throw new Error('User rejected the Kasware request.');
      return input.txJsonString;
    },
    async pushTx(tx) {
      return extractKaswareTransactionId(tx);
    },
  };
  window.kasware = provider;
}

export const MINT_SCENES = [
  'connect-missing',
  'collection',
  'sold-out',
  'revealing',
  'success',
  'wrong-network',
  'rejected',
  'insufficient',
  'commit-rejected',
  'reveal-unavailable',
  'sold-out-race',
  'next-in-line',
] as const;

export type MintScene = (typeof MINT_SCENES)[number];

export function readScene(search = typeof window === 'undefined' ? '' : window.location.search): MintScene | null {
  const value = new URLSearchParams(search).get('scene');
  if (!value) return null;
  return (MINT_SCENES as readonly string[]).includes(value) ? (value as MintScene) : null;
}

export function sceneWantsWallet(scene: MintScene | null, fixtureWallet: boolean): boolean {
  if (fixtureWallet && scene !== 'connect-missing') return true;
  if (!scene || scene === 'connect-missing') return false;
  return true;
}

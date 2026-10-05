export type SiteNetwork = 'testnet-10' | 'mainnet';

export function siteNetwork(): SiteNetwork {
  return import.meta.env.VITE_KASPA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet-10';
}

export function mintMode(): 'fixture' | 'live' {
  return import.meta.env.VITE_MINT_MODE === 'live' ? 'live' : 'fixture';
}

/**
 * Kasware reports network names, not EVM chain ids.
 * testnet-10 is `kaspa_testnet_10`. mainnet is `kaspa_mainnet`.
 */
export function walletNetworkMatches(walletNetwork: string, site: SiteNetwork): boolean {
  const normalized = walletNetwork.trim().toLowerCase().replace(/-/g, '_');
  if (site === 'testnet-10') {
    return (
      normalized === 'kaspa_testnet_10' ||
      normalized === 'testnet_10' ||
      normalized === 'testnet10'
    );
  }
  return normalized === 'kaspa_mainnet' || normalized === 'mainnet';
}

export function explorerTxUrl(network: SiteNetwork, txid: string): string {
  const base =
    network === 'mainnet' ? 'https://explorer.kaspa.org' : 'https://explorer-tn10.kaspa.org';
  return `${base}/txs/${txid}`;
}

export function addressLooksLikeNetwork(address: string, site: SiteNetwork): boolean {
  const value = address.trim().toLowerCase();
  if (site === 'testnet-10') return value.startsWith('kaspatest:');
  return value.startsWith('kaspa:') && !value.startsWith('kaspatest:');
}

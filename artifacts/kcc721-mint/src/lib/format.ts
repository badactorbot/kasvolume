export const SOMPI_PER_KAS = 100_000_000n;

export function parseSompi(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Expected a sompi integer, received "${text}".`);
  }
  return BigInt(text);
}

export function formatKas(sompi: bigint): string {
  const negative = sompi < 0n;
  const value = negative ? -sompi : sompi;
  const whole = value / SOMPI_PER_KAS;
  const fraction = (value % SOMPI_PER_KAS).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function shortId(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 12)}…${address.slice(-6)}`;
}

export function isCovenantId(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim());
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

export function resolveContentUrl(uri: string): string {
  const value = uri.trim();
  if (value.startsWith('ipfs://')) {
    return `${IPFS_GATEWAY}${value.slice('ipfs://'.length)}`;
  }
  return value;
}

export function joinMetadata(root: string, file: string): string {
  return `${resolveContentUrl(root).replace(/\/$/, '')}/${file}`;
}

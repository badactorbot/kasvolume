export interface KaswareSignInput {
  index: number;
  sighashType: number;
}

export interface KaswareProvider {
  requestAccounts: () => Promise<string[]>;
  getAccounts?: () => Promise<string[]>;
  getPublicKey: () => Promise<string>;
  getNetwork?: () => Promise<string>;
  getBalance: () => Promise<{
    confirmed: string;
    unconfirmed: string;
    total: string;
  } | null>;
  signPskt: (input: {
    txJsonString: string;
    options: { signInputs: KaswareSignInput[] };
  }) => Promise<string>;
  pushTx?: (tx: string) => Promise<string>;
}

declare global {
  interface Window {
    kasware?: KaswareProvider;
  }
}

export const KASWARE_INSTALL_URL = 'https://kasware.xyz';

export function getKasware(): KaswareProvider | undefined {
  if (typeof window !== 'undefined' && window.kasware) {
    return window.kasware;
  }
  return undefined;
}

export function extractKaswareTransactionId(value: string, fallback?: string): string {
  const trimmed = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed.toLowerCase();

  try {
    const parsed = JSON.parse(trimmed) as {
      id?: unknown;
      txid?: unknown;
      transactionId?: unknown;
    };
    const candidate = parsed.id ?? parsed.txid ?? parsed.transactionId;
    if (typeof candidate === 'string' && /^[a-fA-F0-9]{64}$/.test(candidate)) {
      return candidate.toLowerCase();
    }
  } catch {
    // Kasware sometimes returns a bare id, sometimes JSON.
  }

  if (fallback && /^[a-fA-F0-9]{64}$/.test(fallback)) return fallback.toLowerCase();
  throw new Error('Kasware returned an unreadable transaction id.');
}

export function isUserRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /reject|denied|cancel|closed the/i.test(message);
}

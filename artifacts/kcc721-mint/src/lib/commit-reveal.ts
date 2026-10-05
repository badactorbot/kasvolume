import { parseSompi, joinMetadata, resolveContentUrl } from './format';

/**
 * Commit/reveal adapter for the KCC721 reference server
 * (KaspaHUB21/KCC721-A-Kaspa-NFT-Covenant-Proposal @ 8d26173fce52d66555134550256b2e14fe6408b2).
 *
 * The page asks this API for an unsigned Safe JSON transaction and passes
 * `txJsonString` plus `signInputs` to Kasware. It does not build a covenant.
 *
 * Endpoints, matching reference/server.py:
 *   GET  /api/kcc721/collection?id=
 *   POST /api/kcc721/prepare-mint
 *   GET  /api/kcc721/mint-queue?operationId=&walletAddress=
 *   POST /api/kcc721/register-broadcast
 *   GET  /api/kcc721/transaction?txid=
 *   POST /api/kcc721/prepare-reveal
 *   GET  /api/kcc721/nft-detail?id=&tokenId=
 *
 * Funding UTXOs and acceptance on testnet-10 are read from the public REST
 * API (`/kaspa-rest` → api-tn10.kaspa.org). The published reference server
 * reads api.kaspa.org and only accepts `kaspa:` addresses.
 */

export interface SignInput {
  index: number;
  sighashType: number;
}

export interface FundingUtxo {
  transactionId: string;
  index: number;
  amount: string;
  scriptPublicKey: string;
  blockDaaScore: string;
  isCoinbase: boolean;
}

export interface CollectionSnapshot {
  collectionId: string;
  ticker: string;
  name: string;
  description: string;
  imageUrl: string;
  maxSupply: number;
  minted: number;
  mintPriceSompi: bigint;
  metadataUri: string;
  controllerBusy: boolean;
  version: string;
}

export interface TokenMetadata {
  tokenId: number;
  name: string;
  description: string;
  imageUrl: string;
  metadataUri: string;
}

export interface MintCommitPrepared {
  mode: 'mint-commit';
  txJsonString: string;
  signInputs: SignInput[];
  transactionId: string;
  operationId: string;
  feeSompi: bigint;
  ticketId: string;
  mintIndex: number;
  collectionId: string;
}

export interface MintQueued {
  mode: 'mint-queued';
  operationId: string;
  collectionId: string;
  queuePosition: number;
  ready: boolean;
  expired: boolean;
  status: string;
}

export type PrepareMintResult = MintCommitPrepared | MintQueued;

export interface RevealPrepared {
  mode: 'mint-reveal';
  txJsonString: string;
  signInputs: SignInput[];
  transactionId: string;
  operationId: string;
  nftId: string;
  tokenId: number;
  feeSompi: bigint;
  collectionId: string;
  metadataUri: string;
}

export interface TxAcceptance {
  txid: string;
  accepted: boolean;
  status: string;
  registryError: string | null;
}

export interface PrepareMintBody {
  collectionId: string;
  walletAddress: string;
  publicKey: string;
  fundingUtxo: FundingUtxo;
  queueOperationId?: string;
}

export interface CommitRevealApi {
  getCollection(collectionId: string): Promise<CollectionSnapshot>;
  listFundingUtxos(address: string): Promise<FundingUtxo[]>;
  prepareMint(body: PrepareMintBody): Promise<PrepareMintResult>;
  getMintQueue(operationId: string, walletAddress: string): Promise<MintQueued>;
  registerBroadcast(operationId: string, txid: string): Promise<void>;
  getTransaction(txid: string): Promise<TxAcceptance>;
  prepareReveal(commitOperationId: string, walletAddress: string): Promise<RevealPrepared>;
  getTokenMetadata(metadataUri: string, tokenId: number): Promise<TokenMetadata>;
}

export type CommitRevealErrorKind =
  | 'sold-out'
  | 'reveal-unavailable'
  | 'not-accepted'
  | 'not-found'
  | 'unavailable'
  | 'bad-request';

export class CommitRevealError extends Error {
  readonly kind: CommitRevealErrorKind;
  readonly httpStatus: number;

  constructor(message: string, kind: CommitRevealErrorKind, httpStatus = 400) {
    super(message);
    this.name = 'CommitRevealError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export function classifyCommitRevealMessage(
  message: string,
  httpStatus = 400,
): CommitRevealErrorKind {
  if (/fully minted/i.test(message)) return 'sold-out';
  if (/reveal data is unavailable/i.test(message)) return 'reveal-unavailable';
  if (/must be accepted before reveal/i.test(message)) return 'not-accepted';
  if (httpStatus === 404) return 'not-found';
  if (httpStatus === 502 || httpStatus === 504) return 'unavailable';
  return 'bad-request';
}

interface RegistryCollection {
  collectionId: string;
  ticker: string;
  maxSupply: number;
  metadataUri: string;
  mintPriceSompi: string;
  nextTokenId: number;
  status: string;
  version?: string;
  mintMode?: string;
  controllerBusy?: boolean;
}

interface ArtDocument {
  name?: unknown;
  description?: unknown;
  image?: unknown;
}

export function mintedFromNextIndex(nextTokenId: number, maxSupply: number, version: string): number {
  const minted = version.startsWith('0.2') ? Math.max(0, nextTokenId - 1) : nextTokenId;
  return Math.min(Math.max(0, minted), maxSupply);
}

async function readError(response: Response): Promise<CommitRevealError> {
  let message = response.statusText || 'Mint service request failed.';
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) message = body.error.trim();
  } catch {
    // Non-JSON errors still carry the HTTP status.
  }
  return new CommitRevealError(
    message,
    classifyCommitRevealMessage(message, response.status),
    response.status,
  );
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

function asSignInputs(value: unknown): SignInput[] {
  if (!Array.isArray(value)) {
    throw new CommitRevealError('Mint service omitted signInputs.', 'bad-request');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new CommitRevealError('Mint service returned a malformed signInputs entry.', 'bad-request');
    }
    const index = Number((item as { index?: unknown }).index);
    const sighashType = Number((item as { sighashType?: unknown }).sighashType);
    if (!Number.isInteger(index) || index < 0 || !Number.isInteger(sighashType)) {
      throw new CommitRevealError('Mint service returned an unusable signInputs entry.', 'bad-request');
    }
    return { index, sighashType };
  });
}

async function fetchArt(url: string): Promise<ArtDocument | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as ArtDocument;
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

function artFields(doc: ArtDocument | null, fallbackName: string) {
  const name = typeof doc?.name === 'string' && doc.name.trim() ? doc.name.trim() : fallbackName;
  const description = typeof doc?.description === 'string' ? doc.description : '';
  const image = typeof doc?.image === 'string' ? resolveContentUrl(doc.image) : '';
  return { name, description, imageUrl: image };
}

export function selectFundingUtxo(utxos: FundingUtxo[], minimumSompi: bigint): FundingUtxo {
  const eligible = utxos
    .filter((utxo) => !utxo.isCoinbase && BigInt(utxo.amount) >= minimumSompi)
    .sort((a, b) => {
      const left = BigInt(a.amount);
      const right = BigInt(b.amount);
      if (left === right) return 0;
      return left < right ? -1 : 1;
    });
  const chosen = eligible[0];
  if (!chosen) {
    throw new CommitRevealError(
      'No confirmed plain output covers the mint price, fee, and dust.',
      'bad-request',
    );
  }
  return chosen;
}

export class ReferenceCommitRevealClient implements CommitRevealApi {
  private readonly apiBase: string;

  constructor(apiBase = '') {
    this.apiBase = apiBase;
  }

  async getCollection(collectionId: string): Promise<CollectionSnapshot> {
    const response = await fetch(
      `${this.apiBase}/api/kcc721/collection?id=${encodeURIComponent(collectionId)}`,
      { cache: 'no-store' },
    );
    const data = await readJson<RegistryCollection>(response);
    const version = String(data.version ?? '');
    const art = await fetchArt(joinMetadata(data.metadataUri, 'collection.json'));
    const fields = artFields(art, data.ticker);
    return {
      collectionId: data.collectionId,
      ticker: data.ticker,
      name: fields.name,
      description: fields.description,
      imageUrl: fields.imageUrl,
      maxSupply: Number(data.maxSupply),
      minted: mintedFromNextIndex(Number(data.nextTokenId), Number(data.maxSupply), version || '0.2.0'),
      mintPriceSompi: parseSompi(data.mintPriceSompi),
      metadataUri: data.metadataUri,
      controllerBusy: Boolean(data.controllerBusy),
      version: version || '0.2.0',
    };
  }

  async listFundingUtxos(address: string): Promise<FundingUtxo[]> {
    const response = await fetch(
      `/kaspa-rest/addresses/${encodeURIComponent(address)}/utxos`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      throw new CommitRevealError('Wallet outputs could not be read from the Kaspa API.', 'unavailable', response.status);
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new CommitRevealError('Kaspa API returned an unexpected UTXO payload.', 'unavailable', 502);
    }
    const items: FundingUtxo[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as {
        outpoint?: { transactionId?: unknown; index?: unknown };
        utxoEntry?: {
          amount?: unknown;
          scriptPublicKey?: { scriptPublicKey?: unknown; script?: unknown } | string;
          blockDaaScore?: unknown;
          isCoinbase?: unknown;
        };
      };
      const transactionId = String(row.outpoint?.transactionId ?? '');
      if (!/^[0-9a-fA-F]{64}$/.test(transactionId)) continue;
      const scriptData = row.utxoEntry?.scriptPublicKey;
      const script =
        typeof scriptData === 'string'
          ? scriptData
          : String(scriptData?.scriptPublicKey ?? scriptData?.script ?? '');
      if (!/^[0-9a-fA-F]+$/.test(script)) continue;
      items.push({
        transactionId: transactionId.toLowerCase(),
        index: Number(row.outpoint?.index ?? 0),
        amount: String(row.utxoEntry?.amount ?? '0'),
        scriptPublicKey: script.toLowerCase(),
        blockDaaScore: String(row.utxoEntry?.blockDaaScore ?? '0'),
        isCoinbase: Boolean(row.utxoEntry?.isCoinbase),
      });
    }
    return items;
  }

  async prepareMint(body: PrepareMintBody): Promise<PrepareMintResult> {
    const response = await fetch(`${this.apiBase}/api/kcc721/prepare-mint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readJson<Record<string, unknown>>(response);
    if (data.mode === 'mint-queued') {
      return {
        mode: 'mint-queued',
        operationId: String(data.operationId ?? ''),
        collectionId: String(data.collectionId ?? body.collectionId),
        queuePosition: Number(data.queuePosition ?? 0),
        ready: Boolean(data.ready),
        expired: Boolean(data.expired),
        status: String(data.status ?? ''),
      };
    }
    return {
      mode: 'mint-commit',
      txJsonString: String(data.txJsonString ?? ''),
      signInputs: asSignInputs(data.signInputs),
      transactionId: String(data.transactionId ?? ''),
      operationId: String(data.operationId ?? ''),
      feeSompi: parseSompi(String(data.feeSompi ?? '0')),
      ticketId: String(data.ticketId ?? ''),
      mintIndex: Number(data.mintIndex ?? 0),
      collectionId: String(data.collectionId ?? body.collectionId),
    };
  }

  async getMintQueue(operationId: string, walletAddress: string): Promise<MintQueued> {
    const query = new URLSearchParams({ operationId, walletAddress });
    const response = await fetch(`${this.apiBase}/api/kcc721/mint-queue?${query}`, {
      cache: 'no-store',
    });
    const data = await readJson<Record<string, unknown>>(response);
    return {
      mode: 'mint-queued',
      operationId: String(data.operationId ?? operationId),
      collectionId: String(data.collectionId ?? ''),
      queuePosition: Number(data.queuePosition ?? 0),
      ready: Boolean(data.ready),
      expired: Boolean(data.expired),
      status: String(data.status ?? ''),
    };
  }

  async registerBroadcast(operationId: string, txid: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/api/kcc721/register-broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId, txid }),
    });
    await readJson(response);
  }

  async getTransaction(txid: string): Promise<TxAcceptance> {
    const response = await fetch(
      `${this.apiBase}/api/kcc721/transaction?txid=${encodeURIComponent(txid)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) {
      return { txid, accepted: false, status: 'pending', registryError: null };
    }
    const data = await readJson<{
      txid?: string;
      accepted?: boolean;
      status?: string;
      registryError?: string | null;
    }>(response);
    return {
      txid: data.txid ?? txid,
      accepted: Boolean(data.accepted),
      status: data.status ?? (data.accepted ? 'accepted' : 'pending'),
      registryError: data.registryError ?? null,
    };
  }

  async prepareReveal(commitOperationId: string, walletAddress: string): Promise<RevealPrepared> {
    const response = await fetch(`${this.apiBase}/api/kcc721/prepare-reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commitOperationId, walletAddress }),
    });
    const data = await readJson<Record<string, unknown>>(response);
    return {
      mode: 'mint-reveal',
      txJsonString: String(data.txJsonString ?? ''),
      signInputs: asSignInputs(data.signInputs ?? []),
      transactionId: String(data.transactionId ?? ''),
      operationId: String(data.operationId ?? ''),
      nftId: String(data.nftId ?? ''),
      tokenId: Number(data.tokenId ?? 0),
      feeSompi: parseSompi(String(data.feeSompi ?? '0')),
      collectionId: String(data.collectionId ?? ''),
      metadataUri: String(data.metadataUri ?? ''),
    };
  }

  async getTokenMetadata(metadataUri: string, tokenId: number): Promise<TokenMetadata> {
    const metadataFile = joinMetadata(metadataUri, `${tokenId}.json`);
    const doc = await fetchArt(metadataFile);
    const fields = artFields(doc, `#${tokenId}`);
    return {
      tokenId,
      name: fields.name,
      description: fields.description,
      imageUrl: fields.imageUrl,
      metadataUri: metadataFile,
    };
  }
}

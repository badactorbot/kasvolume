import type { MintScene } from './scene';
import {
  CommitRevealError,
  mintedFromNextIndex,
  selectFundingUtxo,
  type CollectionSnapshot,
  type CommitRevealApi,
  type FundingUtxo,
  type MintQueued,
  type PrepareMintBody,
  type PrepareMintResult,
  type RevealPrepared,
  type TokenMetadata,
  type TxAcceptance,
} from './commit-reveal';
import {
  FIXTURE_COLLECTION_ID,
  FIXTURE_COMMIT_SIGN_INPUTS,
  FIXTURE_COMMIT_TXID,
  FIXTURE_NFT_ID,
  FIXTURE_OPERATION_ID,
  FIXTURE_REVEAL_OPERATION_ID,
  FIXTURE_REVEAL_TXID,
  FIXTURE_TICKET_ID,
} from './ids';

const METADATA_ROOT = '/fixture/ash-line';
const MINT_PRICE = 100_000_000n;
const TOKEN_NAMES = ['', 'First crack', 'Shoulder', 'Lip', 'Cooled foot', 'Last shard'];

interface FixtureTx {
  txid: string;
  status: 'pending' | 'accepted' | 'rejected';
  polls: number;
}

/**
 * In-memory stand-in for the reference commit/reveal routes.
 * Responses use the same modes and error strings as reference/server.py.
 * Transaction JSON is an opaque envelope, not a covenant.
 */
export class FixtureCommitRevealApi implements CommitRevealApi {
  private txs = new Map<string, FixtureTx>();
  private commitAccepted = false;
  private revealed: boolean;
  private readonly scene: MintScene | null;

  constructor(scene: MintScene | null) {
    this.scene = scene;
    this.revealed = scene === 'success';
  }

  async getCollection(collectionId: string): Promise<CollectionSnapshot> {
    if (collectionId.toLowerCase() !== FIXTURE_COLLECTION_ID) {
      throw new CommitRevealError('KCC721 collection was not found.', 'not-found', 404);
    }
    const soldOut = this.scene === 'sold-out' || this.scene === 'sold-out-race';
    const nextTokenId = soldOut ? 6 : this.revealed ? 4 : 3;
    const maxSupply = 5;
    return {
      collectionId: FIXTURE_COLLECTION_ID,
      ticker: 'ASH',
      name: 'Ash Line',
      description: 'Five vessels from one firing. The token id stays hidden until reveal.',
      imageUrl: `${METADATA_ROOT}/cover.svg`,
      maxSupply,
      minted: mintedFromNextIndex(nextTokenId, maxSupply, '0.2.0'),
      mintPriceSompi: MINT_PRICE,
      metadataUri: METADATA_ROOT,
      controllerBusy: this.scene === 'next-in-line',
      version: '0.2.0',
    };
  }

  async listFundingUtxos(address: string): Promise<FundingUtxo[]> {
    const amount = this.scene === 'insufficient' ? '40000000' : '2500000000';
    return [
      {
        transactionId: 'aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900',
        index: 0,
        amount,
        scriptPublicKey: '20' + '11'.repeat(32) + 'ac',
        blockDaaScore: '1',
        isCoinbase: false,
      },
      {
        transactionId: address ? 'bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900aa' : '',
        index: 1,
        amount: '9000000000',
        scriptPublicKey: '20' + '22'.repeat(32) + 'ac',
        blockDaaScore: '1',
        isCoinbase: true,
      },
    ].filter((item) => /^[0-9a-f]{64}$/.test(item.transactionId));
  }

  async prepareMint(body: PrepareMintBody): Promise<PrepareMintResult> {
    if (this.scene === 'sold-out' || this.scene === 'sold-out-race') {
      throw new CommitRevealError('This KCC721 collection is fully minted.', 'sold-out', 400);
    }
    if (this.scene === 'next-in-line' && !body.queueOperationId) {
      return {
        mode: 'mint-queued',
        operationId: FIXTURE_OPERATION_ID,
        collectionId: body.collectionId,
        queuePosition: 2,
        ready: false,
        expired: false,
        status: 'mint queue position 2',
      };
    }
    const txJsonString = JSON.stringify({
      id: FIXTURE_COMMIT_TXID,
      kind: 'fixture-commit-envelope',
    });
    return {
      mode: 'mint-commit',
      txJsonString,
      signInputs: FIXTURE_COMMIT_SIGN_INPUTS.map((item) => ({ ...item })),
      transactionId: FIXTURE_COMMIT_TXID,
      operationId: FIXTURE_OPERATION_ID,
      feeSompi: 86_400n,
      ticketId: FIXTURE_TICKET_ID,
      mintIndex: 3,
      collectionId: body.collectionId,
    };
  }

  async getMintQueue(operationId: string): Promise<MintQueued> {
    return {
      mode: 'mint-queued',
      operationId,
      collectionId: FIXTURE_COLLECTION_ID,
      queuePosition: 2,
      ready: false,
      expired: false,
      status: 'mint queue position 2',
    };
  }

  async registerBroadcast(_operationId: string, txid: string): Promise<void> {
    const rejected = this.scene === 'commit-rejected' && txid === FIXTURE_COMMIT_TXID;
    this.txs.set(txid, {
      txid,
      status: rejected ? 'rejected' : 'pending',
      polls: 0,
    });
    if (txid === FIXTURE_COMMIT_TXID && !rejected) this.commitAccepted = false;
  }

  async getTransaction(txid: string): Promise<TxAcceptance> {
    const known = this.txs.get(txid);
    if (!known) {
      if (this.scene === 'revealing' && txid === FIXTURE_COMMIT_TXID) {
        return { txid, accepted: true, status: 'accepted', registryError: null };
      }
      return { txid, accepted: false, status: 'pending', registryError: null };
    }
    known.polls += 1;
    if (known.status === 'rejected') {
      return { txid, accepted: false, status: 'rejected', registryError: null };
    }
    if (known.polls >= 1) {
      known.status = 'accepted';
      if (txid === FIXTURE_COMMIT_TXID) this.commitAccepted = true;
      if (txid === FIXTURE_REVEAL_TXID) this.revealed = true;
    }
    return {
      txid,
      accepted: known.status === 'accepted',
      status: known.status,
      registryError: null,
    };
  }

  async prepareReveal(commitOperationId: string, _walletAddress: string): Promise<RevealPrepared> {
    if (this.scene === 'reveal-unavailable') {
      throw new CommitRevealError(
        'The committed blind mint reveal data is unavailable.',
        'reveal-unavailable',
        500,
      );
    }
    if (commitOperationId !== FIXTURE_OPERATION_ID && this.scene !== 'revealing' && !this.commitAccepted) {
      throw new CommitRevealError(
        'Blind mint commitment must be accepted before reveal.',
        'not-accepted',
        400,
      );
    }
    return {
      mode: 'mint-reveal',
      txJsonString: JSON.stringify({
        id: FIXTURE_REVEAL_TXID,
        kind: 'fixture-reveal-envelope',
      }),
      signInputs: [],
      transactionId: FIXTURE_REVEAL_TXID,
      operationId: FIXTURE_REVEAL_OPERATION_ID,
      nftId: FIXTURE_NFT_ID,
      tokenId: 4,
      feeSompi: 42_000n,
      collectionId: FIXTURE_COLLECTION_ID,
      metadataUri: METADATA_ROOT,
    };
  }

  async getTokenMetadata(metadataUri: string, tokenId: number): Promise<TokenMetadata> {
    const root = metadataUri.replace(/\/$/, '');
    const metadataFile = `${root}/${tokenId}.json`;
    const fallbackName = TOKEN_NAMES[tokenId] ?? `Piece ${tokenId}`;
    try {
      const response = await fetch(metadataFile, { cache: 'no-store' });
      if (response.ok) {
        const doc = (await response.json()) as { name?: unknown; description?: unknown; image?: unknown };
        return {
          tokenId,
          name: typeof doc.name === 'string' ? doc.name : `Ash Line #${tokenId}`,
          description: typeof doc.description === 'string' ? doc.description : fallbackName,
          imageUrl: typeof doc.image === 'string' ? doc.image : `${root}/${tokenId}.svg`,
          metadataUri: metadataFile,
        };
      }
    } catch {
      // Fixture art is local. A missing file still returns a piece.
    }
    return {
      tokenId,
      name: `Ash Line #${tokenId}`,
      description: fallbackName,
      imageUrl: `${root}/${tokenId}.svg`,
      metadataUri: metadataFile,
    };
  }
}

export function fixtureFundingOrThrow(
  api: CommitRevealApi,
  address: string,
  minimum: bigint,
): Promise<FundingUtxo> {
  return api.listFundingUtxos(address).then((utxos) => selectFundingUtxo(utxos, minimum));
}

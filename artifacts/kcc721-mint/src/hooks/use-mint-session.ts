import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CommitRevealError,
  ReferenceCommitRevealClient,
  selectFundingUtxo,
  type CollectionSnapshot,
  type CommitRevealApi,
  type RevealPrepared,
} from '../lib/commit-reveal';
import { FixtureCommitRevealApi } from '../lib/fixture-api';
import {
  extractKaswareTransactionId,
  getKasware,
  isUserRejection,
  KASWARE_INSTALL_URL,
} from '../lib/kasware';
import {
  addressLooksLikeNetwork,
  explorerTxUrl,
  mintMode,
  siteNetwork,
  walletNetworkMatches,
  type SiteNetwork,
} from '../lib/network';
import { quoteMint, balanceCovers, type MintQuote } from '../lib/quote';
import { readScene, type MintScene } from '../lib/scene';
import { isCovenantId, parseSompi } from '../lib/format';
import {
  FIXTURE_COLLECTION_ID,
  FIXTURE_COMMIT_TXID,
  FIXTURE_NFT_ID,
  FIXTURE_OPERATION_ID,
  FIXTURE_REVEAL_TXID,
} from '../lib/ids';

export interface WalletSnapshot {
  address: string;
  publicKey: string;
  network: string;
  confirmedSompi: bigint;
  unconfirmedSompi: bigint;
}

export interface RevealedPiece {
  tokenId: number;
  name: string;
  description: string;
  imageUrl: string;
  metadataUri: string;
  nftId: string;
  commitTxid: string;
  revealTxid: string;
}

export type MintPhase =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'signing' }
  | { type: 'next-in-line'; position: number }
  | { type: 'awaiting-commit'; commitTxid: string; operationId: string }
  | { type: 'revealing'; commitTxid: string; operationId: string }
  | { type: 'success'; piece: RevealedPiece };

export type MintNotice =
  | { type: 'wallet-missing' }
  | { type: 'wrong-network'; walletNetwork: string }
  | { type: 'rejected' }
  | { type: 'insufficient' }
  | { type: 'commit-rejected'; commitTxid?: string }
  | { type: 'reveal-unavailable'; commitTxid: string }
  | { type: 'sold-out-race' }
  | { type: 'message'; text: string };

const SUCCESS_PIECE: RevealedPiece = {
  tokenId: 4,
  name: 'Ash Line #4',
  description: 'Cooled foot. The foot ring still holds the kiln ash.',
  imageUrl: '/fixture/ash-line/4.svg',
  metadataUri: '/fixture/ash-line/4.json',
  nftId: FIXTURE_NFT_ID,
  commitTxid: FIXTURE_COMMIT_TXID,
  revealTxid: FIXTURE_REVEAL_TXID,
};

function createApi(scene: MintScene | null): CommitRevealApi {
  if (mintMode() === 'live') return new ReferenceCommitRevealClient();
  return new FixtureCommitRevealApi(scene);
}

function collectionIdFromLocation(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('id')?.trim() ?? '';
  if (fromUrl) return fromUrl;
  const fromEnv = import.meta.env.VITE_COLLECTION_ID?.trim() ?? '';
  if (fromEnv) return fromEnv;
  return mintMode() === 'fixture' ? FIXTURE_COLLECTION_ID : '';
}

function seededPhase(scene: MintScene | null): MintPhase {
  if (scene === 'revealing' || scene === 'reveal-unavailable') {
    return {
      type: 'revealing',
      commitTxid: FIXTURE_COMMIT_TXID,
      operationId: FIXTURE_OPERATION_ID,
    };
  }
  if (scene === 'success') return { type: 'success', piece: SUCCESS_PIECE };
  if (scene === 'next-in-line') return { type: 'next-in-line', position: 2 };
  return { type: 'ready' };
}

function seededNotice(scene: MintScene | null): MintNotice | null {
  if (scene === 'rejected') return { type: 'rejected' };
  if (scene === 'commit-rejected') return { type: 'commit-rejected', commitTxid: FIXTURE_COMMIT_TXID };
  if (scene === 'reveal-unavailable') {
    return { type: 'reveal-unavailable', commitTxid: FIXTURE_COMMIT_TXID };
  }
  if (scene === 'sold-out-race') return { type: 'sold-out-race' };
  return null;
}

async function readWallet(): Promise<WalletSnapshot | null> {
  const kasware = getKasware();
  if (!kasware) return null;
  const accounts = kasware.getAccounts ? await kasware.getAccounts() : [];
  const address = accounts?.[0];
  if (!address) return null;
  const publicKey = await kasware.getPublicKey();
  const network = kasware.getNetwork ? await kasware.getNetwork() : '';
  const balance = await kasware.getBalance();
  return {
    address,
    publicKey,
    network,
    confirmedSompi: parseSompi(balance?.confirmed ?? '0'),
    unconfirmedSompi: parseSompi(balance?.unconfirmed ?? '0'),
  };
}

export function useMintSession() {
  const scene = mintMode() === 'fixture' ? readScene() : null;
  const network = siteNetwork();
  const api = useMemo(() => createApi(scene), [scene]);
  const collectionId = collectionIdFromLocation();
  const [collection, setCollection] = useState<CollectionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [phase, setPhase] = useState<MintPhase>(seededPhase(scene));
  const [notice, setNotice] = useState<MintNotice | null>(seededNotice(scene));
  const [engineFee, setEngineFee] = useState<bigint | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const lock = useRef(false);

  const reloadCollection = useCallback(async () => {
    if (!isCovenantId(collectionId)) {
      setCollection(null);
      setLoadError(
        collectionId
          ? 'That value is not a 32-byte covenant id.'
          : 'Open this mint with ?id= and the collection covenant id.',
      );
      return;
    }
    try {
      const next = await api.getCollection(collectionId.toLowerCase());
      setCollection(next);
      setLoadError(null);
    } catch (error) {
      setCollection(null);
      setLoadError(error instanceof Error ? error.message : 'Collection could not be loaded.');
    }
  }, [api, collectionId]);

  useEffect(() => {
    void reloadCollection();
  }, [reloadCollection]);

  useEffect(() => {
    let cancelled = false;
    void readWallet().then((snapshot) => {
      if (!cancelled && snapshot) setWallet(snapshot);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const quote: MintQuote | null = collection
    ? quoteMint(collection.mintPriceSompi, engineFee)
    : null;

  const networkMismatch = Boolean(
    wallet &&
      (!wallet.network ||
        !walletNetworkMatches(wallet.network, network) ||
        !addressLooksLikeNetwork(wallet.address, network)),
  );

  const shortBalance = Boolean(wallet && quote && !balanceCovers(wallet.confirmedSompi, quote.requiredSompi));
  const soldOut = Boolean(collection && collection.minted >= collection.maxSupply);
  const kaswareMissing = getKasware() === undefined;

  const connect = useCallback(async () => {
    const kasware = getKasware();
    if (!kasware) {
      setNotice({ type: 'wallet-missing' });
      return;
    }
    try {
      const existing = kasware.getAccounts ? await kasware.getAccounts().catch(() => []) : [];
      const accounts = existing.length ? existing : await kasware.requestAccounts();
      if (!accounts[0]) throw new Error('Kasware did not return an account.');
      const snapshot = await readWallet();
      if (!snapshot) throw new Error('Kasware did not return an account.');
      setWallet(snapshot);
      setNotice((current) => (current?.type === 'wallet-missing' || current?.type === 'rejected' ? null : current));
    } catch (error) {
      if (isUserRejection(error)) setNotice({ type: 'rejected' });
      else setNotice({ type: 'message', text: error instanceof Error ? error.message : 'Could not connect Kasware.' });
    }
  }, []);

  const finishReveal = useCallback(
    async (reveal: RevealPrepared, commitTxid: string) => {
      const kasware = getKasware();
      if (!kasware?.pushTx) {
        throw new Error('Kasware cannot broadcast the reveal from this browser.');
      }
      const pushed = await kasware.pushTx(reveal.txJsonString);
      const revealTxid = extractKaswareTransactionId(pushed, reveal.transactionId);
      await api.registerBroadcast(reveal.operationId, revealTxid);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const tx = await api.getTransaction(revealTxid);
        if (tx.registryError) throw new Error(tx.registryError);
        if (tx.status === 'rejected') {
          throw new Error('The reveal was rejected. The ticket is still yours. Check reveal again.');
        }
        if (tx.accepted) break;
        await delay(mintMode() === 'fixture' ? 40 : 1500);
      }
      const metadata = await api.getTokenMetadata(reveal.metadataUri || collection?.metadataUri || '', reveal.tokenId);
      setPhase({
        type: 'success',
        piece: {
          tokenId: reveal.tokenId,
          name: metadata.name,
          description: metadata.description,
          imageUrl: metadata.imageUrl,
          metadataUri: metadata.metadataUri,
          nftId: reveal.nftId,
          commitTxid,
          revealTxid,
        },
      });
      setNotice(null);
      await reloadCollection();
    },
    [api, collection?.metadataUri, reloadCollection],
  );

  const revealCommit = useCallback(
    async (operationId: string, commitTxid: string) => {
      if (!wallet) return;
      setPhase({ type: 'revealing', commitTxid, operationId });
      setChecking(true);
      try {
      const reveal = await api.prepareReveal(operationId, wallet.address);
      // The buyer signed the commit only. Reveal is broadcast, never signPskt'd.
      await finishReveal(reveal, commitTxid);
      } catch (error) {
        if (error instanceof CommitRevealError && error.kind === 'reveal-unavailable') {
          setNotice({ type: 'reveal-unavailable', commitTxid });
          setPhase({ type: 'revealing', commitTxid, operationId });
          return;
        }
        if (error instanceof CommitRevealError && error.kind === 'not-accepted') {
          setPhase({ type: 'awaiting-commit', commitTxid, operationId });
          setNotice({
            type: 'message',
            text: 'The commit is not accepted yet. No ticket exists, and you were not charged.',
          });
          return;
        }
        setNotice({
          type: 'message',
          text: error instanceof Error ? error.message : 'Reveal could not be checked.',
        });
      } finally {
        setChecking(false);
      }
    },
    [api, finishReveal, wallet],
  );

  const pollCommit = useCallback(
    async (commitTxid: string, operationId: string) => {
      setChecking(true);
      try {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const tx = await api.getTransaction(commitTxid);
          if (tx.status === 'rejected') {
            setNotice({ type: 'commit-rejected', commitTxid });
            setPhase({ type: 'ready' });
            return;
          }
          if (tx.registryError) {
            setNotice({ type: 'message', text: tx.registryError });
            setPhase({ type: 'awaiting-commit', commitTxid, operationId });
            return;
          }
          if (tx.accepted) {
            await revealCommit(operationId, commitTxid);
            return;
          }
          await delay(mintMode() === 'fixture' ? 40 : 1500);
        }
        setPhase({ type: 'awaiting-commit', commitTxid, operationId });
        setNotice({
          type: 'message',
          text: 'The commit is still pending. No ticket exists until it is accepted, and you were not charged.',
        });
      } finally {
        setChecking(false);
      }
    },
    [api, revealCommit],
  );

  const mint = useCallback(async () => {
    if (lock.current) return;
    if (phase.type === 'revealing' || phase.type === 'awaiting-commit' || phase.type === 'success') return;
    if (soldOut || !collection || !quote) return;
    const kasware = getKasware();
    if (!kasware) {
      setNotice({ type: 'wallet-missing' });
      return;
    }
    lock.current = true;
    try {
      let snapshot = wallet;
      if (!snapshot) {
        await connect();
        snapshot = await readWallet();
        if (snapshot) setWallet(snapshot);
      }
      if (!snapshot) return;
      if (
        !snapshot.network ||
        !walletNetworkMatches(snapshot.network, network) ||
        !addressLooksLikeNetwork(snapshot.address, network)
      ) {
        setNotice({ type: 'wrong-network', walletNetwork: snapshot.network || 'unknown' });
        return;
      }
      if (!balanceCovers(snapshot.confirmedSompi, quote.requiredSompi)) {
        setNotice({ type: 'insufficient' });
        return;
      }
      if (collection.controllerBusy || phase.type === 'next-in-line') {
        setPhase({ type: 'next-in-line', position: phase.type === 'next-in-line' ? phase.position : 2 });
        return;
      }
      setNotice(null);
      setPhase({ type: 'signing' });
      const utxos = await api.listFundingUtxos(snapshot.address);
      const fundingUtxo = selectFundingUtxo(utxos, quote.requiredSompi);
      const prepared = await api.prepareMint({
        collectionId: collection.collectionId,
        walletAddress: snapshot.address,
        publicKey: snapshot.publicKey,
        fundingUtxo,
      });
      if (prepared.mode === 'mint-queued') {
        setPhase({ type: 'next-in-line', position: prepared.queuePosition });
        return;
      }
      setEngineFee(prepared.feeSompi);
      const signed = await kasware.signPskt({
        txJsonString: prepared.txJsonString,
        options: { signInputs: prepared.signInputs },
      });
      if (!kasware.pushTx) throw new Error('This Kasware build cannot broadcast a signed transaction.');
      const pushed = await kasware.pushTx(signed);
      const txid = extractKaswareTransactionId(pushed, prepared.transactionId);
      await api.registerBroadcast(prepared.operationId, txid);
      setPhase({ type: 'awaiting-commit', commitTxid: txid, operationId: prepared.operationId });
      await pollCommit(txid, prepared.operationId);
    } catch (error) {
      if (error instanceof CommitRevealError && error.kind === 'sold-out') {
        setNotice({ type: 'sold-out-race' });
        setPhase({ type: 'ready' });
        await reloadCollection();
        return;
      }
      if (isUserRejection(error)) {
        setNotice({ type: 'rejected' });
        setPhase({ type: 'ready' });
        return;
      }
      setNotice({
        type: 'message',
        text: error instanceof Error ? error.message : 'The mint could not be prepared.',
      });
      setPhase({ type: 'ready' });
    } finally {
      lock.current = false;
    }
  }, [api, collection, connect, network, phase, pollCommit, quote, reloadCollection, soldOut, wallet]);

  const checkCommit = useCallback(async () => {
    if (phase.type !== 'awaiting-commit') return;
    await pollCommit(phase.commitTxid, phase.operationId);
  }, [phase, pollCommit]);

  const checkReveal = useCallback(async () => {
    if (phase.type !== 'revealing') return;
    await revealCommit(phase.operationId, phase.commitTxid);
  }, [phase, revealCommit]);

  const dismissSuccess = useCallback(() => {
    setPhase({ type: 'ready' });
  }, []);

  const activeNotice: MintNotice | null = kaswareMissing
    ? { type: 'wallet-missing' }
    : networkMismatch && wallet
      ? { type: 'wrong-network', walletNetwork: wallet.network || 'unknown' }
      : shortBalance && phase.type === 'ready'
        ? { type: 'insufficient' }
        : notice;

  const screenState = screenStateFor({
    kaswareMissing,
    soldOut,
    phase,
    notice: activeNotice,
    collection,
  });

  const displayImage =
    phase.type === 'success' && phase.piece.imageUrl
      ? phase.piece.imageUrl
      : collection?.imageUrl || '';

  return {
    network,
    explorerTxUrl: (txid: string) => explorerTxUrl(network, txid),
    installUrl: KASWARE_INSTALL_URL,
    collectionId,
    collection,
    loadError,
    wallet,
    phase,
    notice: activeNotice,
    quote,
    checking,
    screenState,
    displayImage,
    soldOut,
    connect,
    mint,
    checkCommit,
    checkReveal,
    dismissSuccess,
  };
}

function screenStateFor(input: {
  kaswareMissing: boolean;
  soldOut: boolean;
  phase: MintPhase;
  notice: MintNotice | null;
  collection: CollectionSnapshot | null;
}): string {
  if (input.phase.type === 'success') return 'success';
  if (input.phase.type === 'revealing') return 'revealing';
  if (input.kaswareMissing) return 'connect-missing';
  if (input.soldOut) return 'sold-out';
  if (input.phase.type === 'next-in-line' || input.collection?.controllerBusy) return 'next-in-line';
  if (input.notice?.type === 'wrong-network') return 'wrong-network';
  if (input.notice?.type === 'insufficient') return 'insufficient';
  if (input.notice?.type === 'rejected') return 'rejected';
  if (input.notice?.type === 'commit-rejected') return 'commit-rejected';
  if (input.notice?.type === 'sold-out-race') return 'sold-out-race';
  if (input.phase.type === 'awaiting-commit') return 'awaiting-commit';
  if (input.collection) return 'collection';
  return 'loading';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type MintSession = ReturnType<typeof useMintSession>;

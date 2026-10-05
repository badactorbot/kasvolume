import { useState } from 'react';
import { formatKas, shortAddress, shortId } from '../lib/format';
import type { MintNotice, MintSession } from '../hooks/use-mint-session';

export function MintScreen({ session }: { session: MintSession }) {
  const { collection, phase, wallet, quote, notice, network } = session;
  const title =
    phase.type === 'success' ? phase.piece.name : collection?.name || (session.loadError ? 'Collection' : 'Loading');
  const kicker = phase.type === 'success' ? collection?.name ?? 'Minted' : 'Blind mint';
  const description =
    phase.type === 'success'
      ? phase.piece.description
      : collection?.description || session.loadError || 'Reading the collection descriptor.';

  return (
    <main className="mint" data-mint-state={session.screenState}>
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>KCC721</span>
        </div>
        <div className={`pill ${notice?.type === 'wrong-network' ? 'pill-bad' : ''}`}>
          {network}
        </div>
        <div className="wallet-slot">
          {wallet ? (
            <span className="address" title={wallet.address}>
              {shortAddress(wallet.address)}
            </span>
          ) : session.screenState === 'connect-missing' ? (
            <a className="text-link" href={session.installUrl} target="_blank" rel="noreferrer">
              Install Kasware
            </a>
          ) : (
            <button type="button" className="text-link" onClick={() => void session.connect()}>
              Connect
            </button>
          )}
        </div>
      </header>

      <section className="stage">
        <figure className="frame">
          {session.displayImage ? (
            <img src={session.displayImage} alt="" />
          ) : (
            <div className="frame-empty">{collection?.ticker ?? 'KCC'}</div>
          )}
          {phase.type === 'success' ? <figcaption>Token {String(phase.piece.tokenId).padStart(2, '0')}</figcaption> : null}
        </figure>

        <div className="panel">
          <p className="kicker">{kicker}</p>
          <h1>{title}</h1>
          {collection ? (
            <p className="ticker">
              <span>{collection.ticker}</span>
              Ticker is only a label.
            </p>
          ) : null}
          <p className="lede">{description}</p>

          <CopyRow
            label="Collection covenant id"
            value={collection?.collectionId ?? session.collectionId}
          />

          {collection ? (
            <Supply minted={collection.minted} max={collection.maxSupply} />
          ) : null}

          {quote && phase.type !== 'success' ? (
            <dl className="quote">
              <Row label="Price" value={`${formatKas(quote.priceSompi)} KAS`} />
              <Row
                label={quote.feeIsEstimate ? 'Estimated fee' : 'Commit fee'}
                value={`${formatKas(quote.feeSompi)} KAS`}
              />
              <Row label="Funding dust" value={`${formatKas(quote.dustSompi)} KAS`} />
              {wallet ? (
                <>
                  <Row label="Confirmed" value={`${formatKas(wallet.confirmedSompi)} KAS`} />
                  <Row
                    label="Unconfirmed"
                    value={`${formatKas(wallet.unconfirmedSompi)} KAS`}
                    hint="Not counted"
                  />
                </>
              ) : null}
            </dl>
          ) : null}

          {phase.type === 'success' ? (
            <SuccessBlock session={session} />
          ) : (
            <>
              <Notice notice={notice} network={network} />
              <PhaseCopy phase={phase.type} position={phase.type === 'next-in-line' ? phase.position : undefined} commitTxid={commitOf(phase)} explorer={session.explorerTxUrl} />
              <Action session={session} />
              <p className="fine">
                One NFT per click. Kasware signs the commit. The reveal does not ask for a second signature, and the token id stays hidden until that reveal is accepted.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function Supply({ minted, max }: { minted: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((minted / max) * 100));
  const done = minted >= max;
  return (
    <div className="supply">
      <div className="supply-row">
        <span>{done ? 'Sold out' : 'Minted'}</span>
        <strong>
          {minted} <em>/ {max}</em>
        </strong>
      </div>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <>
      <dt>
        {label}
        {hint ? <small>{hint}</small> : null}
      </dt>
      <dd>{value}</dd>
    </>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="id-block">
      <div className="id-label">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code title={value}>{value}</code>
    </div>
  );
}

function Notice({ notice, network }: { notice: MintNotice | null; network: string }) {
  if (!notice) return null;
  const text = noticeText(notice, network);
  return (
    <div className={`notice notice-${notice.type}`} role="status">
      <strong>{text.title}</strong>
      <p>{text.body}</p>
      {notice.type === 'wallet-missing' ? null : null}
    </div>
  );
}

function noticeText(notice: MintNotice, network: string): { title: string; body: string } {
  switch (notice.type) {
    case 'wallet-missing':
      return {
        title: 'Kasware is not installed',
        body: 'The mint stops here. Install Kasware, then connect. This page never holds a seed and will not build a covenant transaction itself.',
      };
    case 'wrong-network':
      return {
        title: 'Wrong network',
        body: `Kasware is on ${notice.walletNetwork || 'an unknown network'}. This mint only signs on ${network}. Switch the wallet before a transaction is built.`,
      };
    case 'rejected':
      return {
        title: 'Signature declined',
        body: 'Kasware closed the prompt. Nothing was broadcast.',
      };
    case 'insufficient':
      return {
        title: 'Not enough confirmed KAS',
        body: 'The confirmed balance is short of the price, fee, and dust. Unconfirmed KAS does not count.',
      };
    case 'commit-rejected':
      return {
        title: 'Commit was not accepted',
        body: 'No ticket exists. You were not charged. You can try the mint again.',
      };
    case 'reveal-unavailable':
      return {
        title: 'Reveal data is unavailable',
        body: 'This is an operator incident. The ticket stays yours until a backed-up reveal service finishes it. Checking again does not ask for another payment.',
      };
    case 'sold-out-race':
      return {
        title: 'Sold out',
        body: 'The controller reported the collection fully minted before this commit was accepted.',
      };
    case 'message':
      return { title: 'Mint paused', body: notice.text };
  }
}

function PhaseCopy({
  phase,
  position,
  commitTxid,
  explorer,
}: {
  phase: MintSession['phase']['type'];
  position?: number;
  commitTxid?: string;
  explorer: (txid: string) => string;
}) {
  if (phase === 'revealing' && commitTxid) {
    return (
      <div className="phase">
        <strong>Revealing</strong>
        <p>Commit accepted. The ticket is yours. The token id is still hidden.</p>
        <a href={explorer(commitTxid)} target="_blank" rel="noreferrer">
          Commit {shortId(commitTxid)}
        </a>
      </div>
    );
  }
  if (phase === 'awaiting-commit' && commitTxid) {
    return (
      <div className="phase">
        <strong>Waiting for the commit</strong>
        <p>No ticket exists until this transaction is accepted. You were not charged.</p>
        <a href={explorer(commitTxid)} target="_blank" rel="noreferrer">
          Commit {shortId(commitTxid)}
        </a>
      </div>
    );
  }
  if (phase === 'next-in-line') {
    return (
      <div className="phase">
        <strong>Next in line{position ? ` · ${position}` : ''}</strong>
        <p>This controller is one UTXO. Another commit is already in flight, so this page will not start a second one.</p>
      </div>
    );
  }
  if (phase === 'signing') {
    return (
      <div className="phase">
        <strong>Waiting for Kasware</strong>
        <p>Review the commit in the wallet. Decline it and nothing is broadcast.</p>
      </div>
    );
  }
  return null;
}

function commitOf(phase: MintSession['phase']): string | undefined {
  if (phase.type === 'revealing' || phase.type === 'awaiting-commit') return phase.commitTxid;
  return undefined;
}

function Action({ session }: { session: MintSession }) {
  const { phase, soldOut, notice, checking } = session;
  if (session.screenState === 'connect-missing') {
    return (
      <a className="action" href={session.installUrl} target="_blank" rel="noreferrer">
        Install Kasware
      </a>
    );
  }
  if (!session.wallet) {
    return (
      <button type="button" className="action" onClick={() => void session.connect()}>
        Connect Kasware
      </button>
    );
  }
  if (notice?.type === 'wrong-network') {
    return (
      <button type="button" className="action" disabled>
        Wrong network
      </button>
    );
  }
  if (soldOut || notice?.type === 'sold-out-race') {
    return (
      <button type="button" className="action action-quiet" disabled>
        Sold out
      </button>
    );
  }
  if (notice?.type === 'insufficient') {
    return (
      <button type="button" className="action" disabled>
        Not enough KAS
      </button>
    );
  }
  if (phase.type === 'next-in-line' || session.collection?.controllerBusy) {
    return (
      <button type="button" className="action action-quiet" disabled>
        Next in line
      </button>
    );
  }
  if (phase.type === 'signing') {
    return (
      <button type="button" className="action" disabled>
        Waiting for Kasware
      </button>
    );
  }
  if (phase.type === 'awaiting-commit') {
    return (
      <button type="button" className="action" disabled={checking} onClick={() => void session.checkCommit()}>
        {checking ? 'Checking commit' : 'Check commit'}
      </button>
    );
  }
  if (phase.type === 'revealing') {
    return (
      <button type="button" className="action" disabled={checking} onClick={() => void session.checkReveal()}>
        {checking ? 'Checking reveal' : 'Check reveal'}
      </button>
    );
  }
  return (
    <button type="button" className="action" data-testid="mint-one" onClick={() => void session.mint()}>
      Mint one
    </button>
  );
}

function SuccessBlock({ session }: { session: MintSession }) {
  if (session.phase.type !== 'success') return null;
  const piece = session.phase.piece;
  return (
    <div className="success">
      <p className="success-kicker">Reveal accepted</p>
      <CopyRow label="NFT covenant id" value={piece.nftId} />
      <div className="tx-list">
        <a href={session.explorerTxUrl(piece.commitTxid)} target="_blank" rel="noreferrer">
          <span>Commit</span>
          <code>{shortId(piece.commitTxid, 10, 8)}</code>
        </a>
        <a href={session.explorerTxUrl(piece.revealTxid)} target="_blank" rel="noreferrer">
          <span>Reveal</span>
          <code>{shortId(piece.revealTxid, 10, 8)}</code>
        </a>
      </div>
      {session.soldOut ? null : (
        <button type="button" className="text-link mint-another" onClick={session.dismissSuccess}>
          Mint another
        </button>
      )}
    </div>
  );
}

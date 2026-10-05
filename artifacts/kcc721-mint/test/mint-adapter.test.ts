import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCommitRevealMessage, mintedFromNextIndex, selectFundingUtxo } from '../src/lib/commit-reveal';
import {
  FIXTURE_COLLECTION_ID,
  FIXTURE_COMMIT_TXID,
  FIXTURE_NFT_ID,
  FIXTURE_OPERATION_ID,
  FIXTURE_PUBLIC_KEY,
  FIXTURE_REVEAL_OPERATION_ID,
  FIXTURE_REVEAL_TXID,
  FIXTURE_TICKET_ID,
} from '../src/lib/ids';
import { walletNetworkMatches } from '../src/lib/network';
import { quoteMint, CONTROLLER_CELL_SOMPI, COMMIT_HEADROOM_SOMPI } from '../src/lib/quote';
import { readScene } from '../src/lib/scene';

test('fixture ids match the reference server widths', () => {
  for (const id of [FIXTURE_COLLECTION_ID, FIXTURE_COMMIT_TXID, FIXTURE_REVEAL_TXID, FIXTURE_NFT_ID, FIXTURE_TICKET_ID]) {
    assert.equal(id.length, 64, id);
  }
  assert.equal(FIXTURE_PUBLIC_KEY.length, 64);
  assert.equal(FIXTURE_OPERATION_ID.length, 32);
  assert.equal(FIXTURE_REVEAL_OPERATION_ID.length, 32);
});

test('wallet network must be testnet-10 in dev', () => {
  assert.equal(walletNetworkMatches('kaspa_testnet_10', 'testnet-10'), true);
  assert.equal(walletNetworkMatches('kaspa-testnet-10', 'testnet-10'), true);
  assert.equal(walletNetworkMatches('kaspa_mainnet', 'testnet-10'), false);
  assert.equal(walletNetworkMatches('kaspa_mainnet', 'mainnet'), true);
  assert.equal(walletNetworkMatches('kaspa_testnet_10', 'mainnet'), false);
});

test('quote keeps the reference funding floor', () => {
  const price = 100_000_000n;
  const quote = quoteMint(price);
  assert.equal(quote.requiredSompi, price + CONTROLLER_CELL_SOMPI + COMMIT_HEADROOM_SOMPI);
  assert.equal(quote.feeIsEstimate, true);
  const quoted = quoteMint(price, 5_000_000n);
  assert.equal(quoted.feeIsEstimate, false);
  assert.equal(quoted.feeSompi, 5_000_000n);
  assert.ok(quoted.requiredSompi >= quote.requiredSompi);
});

test('v0.2 minted count comes from the next mint index', () => {
  assert.equal(mintedFromNextIndex(1, 5, '0.2.0'), 0);
  assert.equal(mintedFromNextIndex(3, 5, '0.2.0'), 2);
  assert.equal(mintedFromNextIndex(6, 5, '0.2.0'), 5);
});

test('server errors map onto the mint states', () => {
  assert.equal(classifyCommitRevealMessage('This KCC721 collection is fully minted.'), 'sold-out');
  assert.equal(
    classifyCommitRevealMessage('The committed blind mint reveal data is unavailable.', 500),
    'reveal-unavailable',
  );
  assert.equal(classifyCommitRevealMessage('Transaction not indexed yet.', 404), 'not-found');
});

test('funding selection skips coinbase and prefers the smallest sufficient output', () => {
  const chosen = selectFundingUtxo(
    [
      {
        transactionId: '11'.repeat(32),
        index: 0,
        amount: '9000000000',
        scriptPublicKey: 'aa',
        blockDaaScore: '1',
        isCoinbase: true,
      },
      {
        transactionId: '22'.repeat(32),
        index: 1,
        amount: '3000000000',
        scriptPublicKey: 'bb',
        blockDaaScore: '1',
        isCoinbase: false,
      },
      {
        transactionId: '33'.repeat(32),
        index: 0,
        amount: '1700000000',
        scriptPublicKey: 'cc',
        blockDaaScore: '1',
        isCoinbase: false,
      },
    ],
    1_700_000_000n,
  );
  assert.equal(chosen.transactionId, '33'.repeat(32));
});

test('scene query is closed', () => {
  assert.equal(readScene('?scene=sold-out'), 'sold-out');
  assert.equal(readScene('?scene=nope'), null);
  assert.equal(readScene(''), null);
});

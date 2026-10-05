export const FIXTURE_COLLECTION_ID =
  'e7c721a4b19d0f6c3a58e2d1b0479c6e5f8a1d3b2c4e6f708192a3b4c5d6e7f0';

export const FIXTURE_COMMIT_TXID =
  'c31aa90e7b24d6581f0c4a6e92b7d3058e14f6a2c90b57d34861e0f5a9c2b714';

export const FIXTURE_REVEAL_TXID =
  '9ab40d17e6c25380f1a4926b7de05c3481f6a90b2c57d4e86130f5a9c2b714de';

export const FIXTURE_NFT_ID =
  '4f18c0de92a7b6510e3d8c4a59f216b7d0e4a813c56f290b7a14d8e3c0915b62';

export const FIXTURE_TICKET_ID =
  '71e0c4a9b2d8561f30a47c8e95d1026b4f7a3c8e1d5092b6a4f0c3817e5d2a09';

export const FIXTURE_OPERATION_ID = 'b6e1c0429af8753d10c4e6a8b291d0f7';

export const FIXTURE_REVEAL_OPERATION_ID = 'c8d20419ab6753e01f4a6c8d92e1b0a7';

export const FIXTURE_WALLET_ADDRESS =
  'kaspatest:qypq02ashlinefixtureminter000000000000000000000000000000000';

export const FIXTURE_PUBLIC_KEY =
  'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';

/**
 * Stand-in for the engine's `signInputs`. The page forwards this array
 * and does not invent an index or sighash of its own.
 */
export const FIXTURE_COMMIT_SIGN_INPUTS = [{ index: 1, sighashType: 1 }] as const;

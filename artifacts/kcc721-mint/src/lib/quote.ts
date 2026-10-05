/**
 * Funding floor used by the proposal reference UI before the engine
 * returns a real `feeSompi`: mint price + 0.5 KAS controller cell +
 * 0.2 KAS headroom for the commit fee and the ticket dust that pays reveal.
 * The page displays that headroom as an estimate. `feeSompi` from
 * prepare-mint replaces the fee line when the service answers.
 */
export const CONTROLLER_CELL_SOMPI = 50_000_000n;
export const COMMIT_HEADROOM_SOMPI = 20_000_000n;
export const ESTIMATED_COMMIT_FEE_SOMPI = 1_000_000n;
export const REVEAL_TICKET_DUST_SOMPI = COMMIT_HEADROOM_SOMPI - ESTIMATED_COMMIT_FEE_SOMPI;

export interface MintQuote {
  priceSompi: bigint;
  feeSompi: bigint;
  feeIsEstimate: boolean;
  dustSompi: bigint;
  requiredSompi: bigint;
}

export function quoteMint(priceSompi: bigint, engineFeeSompi?: bigint): MintQuote {
  const feeSompi = engineFeeSompi ?? ESTIMATED_COMMIT_FEE_SOMPI;
  const dustSompi = CONTROLLER_CELL_SOMPI + REVEAL_TICKET_DUST_SOMPI;
  const floor = priceSompi + CONTROLLER_CELL_SOMPI + COMMIT_HEADROOM_SOMPI;
  const withEngineFee = priceSompi + dustSompi + feeSompi;
  return {
    priceSompi,
    feeSompi,
    feeIsEstimate: engineFeeSompi === undefined,
    dustSompi,
    requiredSompi: withEngineFee > floor ? withEngineFee : floor,
  };
}

export function balanceCovers(confirmedSompi: bigint, requiredSompi: bigint): boolean {
  return confirmedSompi >= requiredSompi;
}

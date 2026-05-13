import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_FORECAST_PROGRAM_ID = '6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L';
const DEFAULT_FORECAST_CONFIG = '3raFV27qUQMDCS1vrdZFV16XPYh3HsN7Tn7hDaoNtxYx';
const DEFAULT_CAST_MINT = 'HW7wUzty3SXUC6WVmvfAkot16XxgW14grakSzaSv1BRy';
const DEFAULT_MINT_AUTHORITY = '4mXVdXXaBaTqEf6gMvg9wifWVoNcKwA71tw1h9pHKHBr';
const DEFAULT_VAULT_TOKEN_ACCOUNT = '8x8Fj94pvBz2xwxkgYrLpWrqND5tYeag8KGmL1vuyj7H';
const DEFAULT_ARCIUM_MXE_PROGRAM_ID = '3Ayx79S2apLBQgSVNq3y2mcbsvQeq4ZUVaiYd2xo7WZK';
const DEFAULT_ARCIUM_PROGRAM_ID = 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
const CAST_DECIMALS = 6;
const DAILY_REFILL_SECONDS = 86_400;
const MAX_MARKET_QUESTION_LENGTH = 180;

const MARKET_CATEGORY_VARIANTS = {
  Crypto: 0,
  Politics: 1,
  Sports: 2,
  Science: 3,
  Technology: 4,
  Finance: 5,
  'World Events': 6,
  Other: 7,
};

const MARKET_TYPE_VARIANTS = {
  'Public Market': 0,
  'DAO Room Market': 1,
};

const MARKET_CATEGORY_LABELS = [
  'Crypto',
  'Politics',
  'Sports',
  'Science',
  'Technology',
  'Finance',
  'World Events',
  'Other',
];

const MARKET_TYPE_LABELS = [
  'native',
  'native',
  'polymarket',
];

const MARKET_OUTCOME_VARIANTS = {
  YES: 0,
  NO: 1,
  CANCELLED: 2,
};

export function getForecastRuntimeConfig() {
  return {
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || DEFAULT_RPC_URL,
    programId: new PublicKey(import.meta.env.VITE_FORECAST_PROGRAM_ID || DEFAULT_FORECAST_PROGRAM_ID),
    forecastConfig: new PublicKey(import.meta.env.VITE_FORECAST_CONFIG || DEFAULT_FORECAST_CONFIG),
    castMint: new PublicKey(import.meta.env.VITE_CAST_MINT || DEFAULT_CAST_MINT),
    mintAuthority: new PublicKey(import.meta.env.VITE_MINT_AUTHORITY || DEFAULT_MINT_AUTHORITY),
    vaultTokenAccount: new PublicKey(import.meta.env.VITE_VAULT_TOKEN_ACCOUNT || DEFAULT_VAULT_TOKEN_ACCOUNT),
    arciumMxeProgramId: new PublicKey(import.meta.env.VITE_ARCIUM_MXE_PROGRAM_ID || DEFAULT_ARCIUM_MXE_PROGRAM_ID),
    arciumProgramId: new PublicKey(import.meta.env.VITE_ARCIUM_PROGRAM_ID || DEFAULT_ARCIUM_PROGRAM_ID),
    oddsApiUrl: import.meta.env.VITE_FORECAST_ODDS_API_URL || '',
    arciumStakeApiUrl: import.meta.env.VITE_ARCIUM_STAKE_API_URL || '',
    arciumSettlementApiUrl: import.meta.env.VITE_ARCIUM_SETTLEMENT_API_URL
      || deriveSiblingApiUrl(import.meta.env.VITE_ARCIUM_STAKE_API_URL || '', '/settlement'),
  };
}

export async function syncForecastWallet({ walletProvider, onStatus }) {
  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const owner = walletProvider.publicKey;
  const userCastAccount = getUserCastAccount(config.castMint, owner);
  const faucetClaim = getFaucetClaimAddress(config.programId, owner);

  onStatus?.('Checking $CAST token account...');
  const tx = new Transaction();
  const userCastInfo = await connection.getAccountInfo(userCastAccount);
  if (!userCastInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userCastAccount,
        owner,
        config.castMint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  const faucetClaimInfo = await connection.getAccountInfo(faucetClaim);
  let claimedInitial = Boolean(faucetClaimInfo);
  const claimedInitialNow = !claimedInitial;

  if (!claimedInitial) {
    onStatus?.('Claiming initial 1,000 $CAST...');
    tx.add(buildClaimInitialCastInstruction({ config, owner, userCastAccount, faucetClaim }));
  }

  if (tx.instructions.length) {
    await sendWalletTransaction({ connection, walletProvider, tx });
    claimedInitial = true;
  }

  const balance = await readCastBalance(connection, userCastAccount);
  const refill = await readRefillStatus(connection, faucetClaim);

  return {
    balance,
    userCastAccount: userCastAccount.toBase58(),
    faucetClaim: faucetClaim.toBase58(),
    claimedInitial,
    claimedInitialNow,
    refill,
  };
}

function buildArciumSubmitPrivateStakeInstruction({ config, owner, arciumPayload }) {
  if (!arciumPayload?.queueable) return null;

  const hints = arciumPayload.accountHints || {};
  const programId = parsePublicKey(arciumPayload.programId) || config.arciumMxeProgramId;
  const arciumProgram = parsePublicKey(hints.arciumProgram) || config.arciumProgramId;
  const fields = arciumPayload.ciphertextFields || {};

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: requirePublicKey(hints.signPdaAccount, 'Arcium signer PDA'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.mxeAccount, 'Arcium MXE account'), isSigner: false, isWritable: false },
      { pubkey: requirePublicKey(hints.mempoolAccount, 'Arcium mempool account'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.executingPool, 'Arcium executing pool'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.computationAccount, 'Arcium computation account'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.compDefAccount, 'Arcium computation definition'), isSigner: false, isWritable: false },
      { pubkey: requirePublicKey(hints.clusterAccount, 'Arcium cluster account'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.poolAccount, 'Arcium fee pool'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.clockAccount, 'Arcium clock account'), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arciumProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:submit_private_stake'),
      bytesFromArray(arciumPayload.computationOffsetLe, 8, 'Arcium computation offset'),
      bytesFromArray(fields.marketId || arciumPayload.ciphertext?.[0], 32, 'encrypted market id'),
      bytesFromArray(fields.position || arciumPayload.ciphertext?.[1], 32, 'encrypted position'),
      bytesFromArray(fields.amount || arciumPayload.ciphertext?.[2], 32, 'encrypted amount'),
      bytesFromArray(fields.multiplier || arciumPayload.ciphertext?.[3], 32, 'encrypted multiplier'),
      bytesFromArray(arciumPayload.clientPublicKey, 32, 'Arcium client public key'),
      writeU128(BigInt(arciumPayload.nonceValue || bytesToBigIntLe(arciumPayload.nonce || []))),
    ]),
  });
}

function buildArciumComputePrivateSettlementInstruction({ config, owner, arciumPayload }) {
  if (!arciumPayload?.queueable) return null;

  const hints = arciumPayload.accountHints || {};
  const programId = parsePublicKey(arciumPayload.programId) || config.arciumMxeProgramId;
  const arciumProgram = parsePublicKey(hints.arciumProgram) || config.arciumProgramId;
  const fields = arciumPayload.ciphertextFields || {};

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: requirePublicKey(hints.signPdaAccount, 'Arcium signer PDA'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.mxeAccount, 'Arcium MXE account'), isSigner: false, isWritable: false },
      { pubkey: requirePublicKey(hints.mempoolAccount, 'Arcium mempool account'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.executingPool, 'Arcium executing pool'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.computationAccount, 'Arcium computation account'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.compDefAccount, 'Arcium computation definition'), isSigner: false, isWritable: false },
      { pubkey: requirePublicKey(hints.clusterAccount, 'Arcium cluster account'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.poolAccount, 'Arcium fee pool'), isSigner: false, isWritable: true },
      { pubkey: requirePublicKey(hints.clockAccount, 'Arcium clock account'), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arciumProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:compute_private_settlement'),
      bytesFromArray(arciumPayload.computationOffsetLe, 8, 'Arcium settlement computation offset'),
      bytesFromArray(fields.userPosition || arciumPayload.ciphertext?.[0], 32, 'encrypted user position'),
      bytesFromArray(fields.winningPosition || arciumPayload.ciphertext?.[1], 32, 'encrypted winning position'),
      bytesFromArray(fields.amount || arciumPayload.ciphertext?.[2], 32, 'encrypted settlement amount'),
      bytesFromArray(fields.multiplier || arciumPayload.ciphertext?.[3], 32, 'encrypted settlement multiplier'),
      bytesFromArray(arciumPayload.clientPublicKey, 32, 'Arcium settlement client public key'),
      writeU128(BigInt(arciumPayload.nonceValue || bytesToBigIntLe(arciumPayload.nonce || []))),
    ]),
  });
}

export async function requestDailyCastRefill(walletProvider) {
  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const owner = walletProvider.publicKey;
  const userCastAccount = getUserCastAccount(config.castMint, owner);
  const faucetClaim = getFaucetClaimAddress(config.programId, owner);
  const refill = await readRefillStatus(connection, faucetClaim);

  if (!refill.claimedInitial) {
    throw new Error('Claim the initial 1,000 $CAST before requesting a daily refill.');
  }

  if (!refill.canRefill) {
    throw new Error(`Daily refill unlocks in ${formatCountdown(refill.secondsUntilRefill)}.`);
  }

  const tx = new Transaction().add(
    buildDailyRefillInstruction({ config, owner, userCastAccount, faucetClaim }),
  );
  await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    balance: await readCastBalance(connection, userCastAccount),
    refill: await readRefillStatus(connection, faucetClaim),
  };
}

export async function createForecastMarket(walletProvider, marketDraft) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect Phantom or Backpack before creating a market.');
  }

  const question = marketDraft.question?.trim();
  const resolutionCriteria = marketDraft.resolutionCriteria?.trim();
  const resolutionTs = toResolutionTimestamp(marketDraft.resolutionDate, marketDraft.resolutionTime);

  if (!question) throw new Error('Market question is required.');
  if (question.length > MAX_MARKET_QUESTION_LENGTH) {
    throw new Error(`Market question must be ${MAX_MARKET_QUESTION_LENGTH} characters or less.`);
  }
  if (!resolutionCriteria) throw new Error('Resolution criteria is required.');
  if (resolutionTs <= Math.floor(Date.now() / 1000)) {
    throw new Error('Resolution date must be in the future.');
  }

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const marketId = makeMarketId();
  const marketIdBytes = writeU64(marketId);
  const marketAddress = getMarketAddress(config.programId, marketIdBytes);
  const criteriaHash = sha256(new TextEncoder().encode(`${question}\n${resolutionCriteria}`));
  const data = encodeCreateMarketData({
    marketId,
    question,
    category: marketDraft.category,
    marketType: marketDraft.marketType,
    resolutionTs,
    oracleEnabled: Boolean(marketDraft.oracleEnabled),
    room: null,
    criteriaHash,
  });

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: config.programId,
      keys: [
        { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
        { pubkey: marketAddress, isSigner: false, isWritable: true },
        { pubkey: walletProvider.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  );

  const signature = await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    signature,
    marketId: marketId.toString(),
    marketAddress: marketAddress.toBase58(),
    creator: walletProvider.publicKey.toBase58(),
    question,
    resolutionTs,
  };
}

export async function fetchForecastNativeMarkets() {
  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const accounts = await connection.getProgramAccounts(config.programId, {
    filters: [
      { dataSize: 8 + 512 },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => decodeMarketAccount(pubkey, account.data))
    .filter(Boolean)
    .sort((a, b) => Number(BigInt(b.marketId || 0) - BigInt(a.marketId || 0)));
}

export async function submitForecastStake(walletProvider, stakeDraft) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect Phantom or Backpack before staking.');
  }

  const amountRaw = castUiAmountToRaw(stakeDraft.amount);
  if (amountRaw <= 0n) {
    throw new Error('Stake amount must be greater than zero.');
  }

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const owner = walletProvider.publicKey;
  const userCastAccount = getUserCastAccount(config.castMint, owner);
  const marketRef = getStakeMarketReference(config.programId, stakeDraft.market);
  const arciumComputation = getArciumComputationReference(config.programId, stakeDraft.arciumPayload, marketRef);
  const encryptedPayloadHash = hashToBytes(stableJson({
    arciumPayload: stakeDraft.arciumPayload,
    market: stakeDraft.market?.id,
    position: stakeDraft.position,
    amountRaw: amountRaw.toString(),
    multiplier: stakeDraft.multiplier,
  }));
  const stakeCommitmentHash = hashToBytes(stableJson({
    owner: owner.toBase58(),
    market: marketRef.toBase58(),
    arciumComputation: arciumComputation.toBase58(),
    encryptedPayloadHash: bytesToHex(encryptedPayloadHash),
  }));
  const stakeCommitment = getStakeCommitmentAddress({
    programId: config.programId,
    owner,
    market: marketRef,
    stakeCommitmentHash,
  });

  const tx = new Transaction();
  const arciumQueueInstruction = buildArciumSubmitPrivateStakeInstruction({
    config,
    owner,
    arciumPayload: stakeDraft.arciumPayload,
  });
  if (arciumQueueInstruction) {
    tx.add(arciumQueueInstruction);
  }

  const userCastInfo = await connection.getAccountInfo(userCastAccount);
  if (!userCastInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userCastAccount,
        owner,
        config.castMint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.add(
    buildDepositCastInstruction({
      config,
      owner,
      userCastAccount,
      amountRaw,
    }),
    buildRecordPrivateStakeInstruction({
      config,
      owner,
      stakeCommitment,
      market: marketRef,
      stakeCommitmentHash,
      arciumComputation,
      encryptedPayloadHash,
    }),
  );

  const signature = await sendWalletTransaction({ connection, walletProvider, tx });
  const stakeResult = {
    signature,
    balance: await readCastBalance(connection, userCastAccount),
    market: marketRef.toBase58(),
    stakeCommitment: stakeCommitment.toBase58(),
    arciumComputation: arciumComputation.toBase58(),
    arciumMxeProgramId: config.arciumMxeProgramId.toBase58(),
    arciumProgramId: config.arciumProgramId.toBase58(),
    arciumCompDefAccount: stakeDraft.arciumPayload?.accountHints?.compDefAccount || '',
    arciumClusterAccount: stakeDraft.arciumPayload?.accountHints?.clusterAccount || '',
    amountRaw: amountRaw.toString(),
  };

  return {
    ...stakeResult,
    settlementRegistration: await requestSettlementRegistration(config, stakeDraft, stakeResult),
    oddsUpdate: await requestPublicOddsUpdate(config, stakeDraft, stakeResult),
  };
}

export async function resolveForecastMarket(walletProvider, market, outcome) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect the creator wallet before resolving a market.');
  }

  const marketAddress = parsePublicKey(market?.marketAddress || market?.id);
  if (!marketAddress || market?.type !== 'native') {
    throw new Error('Only native Forecast markets can be resolved here.');
  }

  const normalizedOutcome = String(outcome || '').toUpperCase();
  const outcomeVariant = MARKET_OUTCOME_VARIANTS[normalizedOutcome];
  if (outcomeVariant === undefined) {
    throw new Error('Choose YES, NO, or CANCELLED as the resolution outcome.');
  }

  if (market.createdBy && market.createdBy !== walletProvider.publicKey.toBase58()) {
    throw new Error('Only the market creator can resolve this market.');
  }

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: config.programId,
      keys: [
        { pubkey: config.forecastConfig, isSigner: false, isWritable: false },
        { pubkey: marketAddress, isSigner: false, isWritable: true },
        { pubkey: walletProvider.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([
        anchorDiscriminator('global:resolve_market'),
        Buffer.from([outcomeVariant]),
      ]),
    }),
  );

  const signature = await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    signature,
    marketAddress: marketAddress.toBase58(),
    status: 'Resolved',
    outcome: normalizedOutcome === 'CANCELLED' ? 'Cancelled' : normalizedOutcome,
  };
}

export async function fetchUserStakeCommitments(walletProvider, market) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect Phantom or Backpack before checking settlement.');
  }

  const marketAddress = parsePublicKey(market?.marketAddress || market?.id);
  if (!marketAddress || market?.type !== 'native') {
    return [];
  }

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const owner = walletProvider.publicKey.toBase58();
  const accounts = await connection.getProgramAccounts(config.programId, {
    filters: [
      { dataSize: 8 + 256 },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => decodeStakeCommitmentAccount(pubkey, account.data))
    .filter((item) => item && item.user === owner && item.market === marketAddress.toBase58())
    .sort((a, b) => Number(b.createdAt - a.createdAt));
}

export async function fetchMarketStakeCommitments(walletProvider, market) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect the market creator wallet before loading settlement commitments.');
  }

  const marketAddress = parsePublicKey(market?.marketAddress || market?.id);
  if (!marketAddress || market?.type !== 'native') {
    return [];
  }

  if (market.createdBy && market.createdBy !== walletProvider.publicKey.toBase58()) {
    throw new Error('Only the market creator can load author settlement controls.');
  }

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const accounts = await connection.getProgramAccounts(config.programId, {
    filters: [
      { dataSize: 8 + 256 },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => decodeStakeCommitmentAccount(pubkey, account.data))
    .filter((item) => item && item.market === marketAddress.toBase58())
    .sort((a, b) => Number(b.createdAt - a.createdAt));
}

export async function queueArciumSettlement(walletProvider, { market, stakeCommitment }) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect the market creator wallet before running Arcium settlement.');
  }

  const marketAddress = parsePublicKey(market?.marketAddress || market?.id);
  const stakeCommitmentAddress = parsePublicKey(stakeCommitment?.address);
  if (!marketAddress || market?.type !== 'native') {
    throw new Error('Only native Forecast markets can run Arcium settlement here.');
  }
  if (market.createdBy && market.createdBy !== walletProvider.publicKey.toBase58()) {
    throw new Error('Only the market creator can run settlement.');
  }
  if (!stakeCommitmentAddress) {
    throw new Error('Stake commitment is missing.');
  }
  if (!['YES', 'NO'].includes(String(market.outcome || '').toUpperCase())) {
    throw new Error('Resolve the market as YES or NO before running settlement.');
  }

  const config = getForecastRuntimeConfig();
  if (!config.arciumSettlementApiUrl) {
    throw new Error('Set VITE_ARCIUM_SETTLEMENT_API_URL or VITE_ARCIUM_STAKE_API_URL to enable Arcium settlement.');
  }

  const response = await fetch(config.arciumSettlementApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: walletProvider.publicKey.toBase58(),
      marketAddress: marketAddress.toBase58(),
      market: {
        marketAddress: marketAddress.toBase58(),
        yes: Number(market.yes || 50),
        no: Number(market.no || 50),
        volume: Number(market.volume || 0),
        volumeDisplay: market.volumeDisplay || '',
      },
      outcome: market.outcome,
      stakeCommitment: stakeCommitmentAddress.toBase58(),
    }),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Arcium settlement service failed with HTTP ${response.status}`);
  }

  const connection = new Connection(config.rpcUrl, 'confirmed');
  const settlementIx = buildArciumComputePrivateSettlementInstruction({
    config,
    owner: walletProvider.publicKey,
    arciumPayload: payload,
  });
  if (!settlementIx) {
    throw new Error('Arcium settlement payload is not queueable.');
  }
  const tx = new Transaction().add(settlementIx);
  const signature = await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    ...payload,
    signature,
    arciumComputation: payload.accountHints?.computationAccount || '',
    arciumMxeProgramId: config.arciumMxeProgramId.toBase58(),
    arciumProgramId: config.arciumProgramId.toBase58(),
    arciumCompDefAccount: payload.accountHints?.compDefAccount || '',
    statusLabel: 'Payout Computation Queued',
  };
}

export async function settleAndPayStake(walletProvider, { market, stakeCommitment, settlementPayload }) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect the market creator wallet before settling payout.');
  }

  const marketAddress = parsePublicKey(market?.marketAddress || market?.id);
  const stakeCommitmentAddress = parsePublicKey(stakeCommitment?.address);
  const stakeUser = parsePublicKey(stakeCommitment?.user);
  const arciumComputation = parsePublicKey(settlementPayload?.arciumComputation || settlementPayload?.accountHints?.computationAccount);

  if (!marketAddress || market?.type !== 'native') {
    throw new Error('Only native Forecast markets can be settled here.');
  }

  if (market.createdBy && market.createdBy !== walletProvider.publicKey.toBase58()) {
    throw new Error('Only the market creator can settle payouts.');
  }

  if (!stakeCommitmentAddress || !stakeUser || !arciumComputation) {
    throw new Error('Stake commitment is missing required Arcium settlement accounts.');
  }

  if (!settlementPayload?.signature) {
    throw new Error('Compute the private payout before paying this commitment.');
  }

  const claimAmountRaw = settlementPayload.claimAmountRaw !== undefined
    ? BigInt(settlementPayload.claimAmountRaw)
    : castUiAmountToRaw(settlementPayload.claimAmount || 0);

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const userCastAccount = getUserCastAccount(config.castMint, stakeUser);
  const encryptedPayoutHash = hashToBytes(stableJson({
    market: marketAddress.toBase58(),
    stakeCommitment: stakeCommitmentAddress.toBase58(),
    user: stakeUser.toBase58(),
    outcome: market.outcome || market.status,
    claimAmountRaw: claimAmountRaw.toString(),
    settlementInputHash: settlementPayload.settlementInputHash || '',
    settlementSignature: settlementPayload.signature,
    arciumComputation: arciumComputation.toBase58(),
  }));

  const tx = new Transaction();
  const userCastInfo = await connection.getAccountInfo(userCastAccount);
  if (!userCastInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        walletProvider.publicKey,
        userCastAccount,
        stakeUser,
        config.castMint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.add(
    buildMarkSettlementReadyInstruction({
      config,
      market: marketAddress,
      stakeCommitment: stakeCommitmentAddress,
      authority: walletProvider.publicKey,
      encryptedPayoutHash,
      arciumComputation,
    }),
    buildMarkClaimedInstruction({
      config,
      market: marketAddress,
      stakeCommitment: stakeCommitmentAddress,
      userCastAccount,
      authority: walletProvider.publicKey,
      claimAmountRaw,
    }),
  );

  const signature = await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    signature,
    claimAmountRaw: claimAmountRaw.toString(),
    userCastAccount: userCastAccount.toBase58(),
    stakeCommitment: stakeCommitmentAddress.toBase58(),
    status: 2,
    statusLabel: 'Claim Recorded',
  };
}

export function getInjectedForecastWallet(walletName) {
  if (typeof window === 'undefined') return null;

  if (walletName === 'Backpack') {
    return window.backpack?.solana || window.backpack || null;
  }

  if (walletName === 'Phantom') {
    return window.phantom?.solana || window.solana || null;
  }

  return window.solana || window.backpack?.solana || null;
}

export function getForecastWalletProvider(walletName) {
  if (walletName === 'Mobile Wallet') {
    return createMobileWalletAdapter();
  }

  return getInjectedForecastWallet(walletName);
}

function createMobileWalletAdapter() {
  if (!isAndroidChrome()) {
    throw new Error('Mobile Wallet Adapter works on Android Chrome. On iOS, open ForeCast inside Phantom or Backpack in-app browser.');
  }

  return new SolanaMobileWalletAdapter({
    addressSelector: createDefaultAddressSelector(),
    appIdentity: {
      name: 'ForeCast',
      uri: typeof window !== 'undefined' ? window.location.origin : 'https://forecast.local',
      icon: '/forecast-mark.svg',
    },
    authorizationResultCache: createDefaultAuthorizationResultCache(),
    cluster: WalletAdapterNetwork.Devnet,
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
}

function isAndroidChrome() {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent || '';
  return /Android/i.test(agent) && /Chrome/i.test(agent) && !/EdgA|OPR|Firefox|Brave/i.test(agent);
}

function buildClaimInitialCastInstruction({ config, owner, userCastAccount, faucetClaim }) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: faucetClaim, isSigner: false, isWritable: true },
      { pubkey: config.castMint, isSigner: false, isWritable: true },
      { pubkey: userCastAccount, isSigner: false, isWritable: true },
      { pubkey: config.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('global:claim_initial_cast'),
  });
}

function buildDailyRefillInstruction({ config, owner, userCastAccount, faucetClaim }) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: faucetClaim, isSigner: false, isWritable: true },
      { pubkey: config.castMint, isSigner: false, isWritable: true },
      { pubkey: userCastAccount, isSigner: false, isWritable: true },
      { pubkey: config.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('global:request_daily_refill'),
  });
}

function buildDepositCastInstruction({ config, owner, userCastAccount, amountRaw }) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: userCastAccount, isSigner: false, isWritable: true },
      { pubkey: config.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:deposit_cast'),
      writeU64(amountRaw),
    ]),
  });
}

function buildRecordPrivateStakeInstruction({
  config,
  owner,
  stakeCommitment,
  market,
  stakeCommitmentHash,
  arciumComputation,
  encryptedPayloadHash,
}) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: stakeCommitment, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:record_private_stake'),
      market.toBuffer(),
      Buffer.from(stakeCommitmentHash),
      arciumComputation.toBuffer(),
      Buffer.from(encryptedPayloadHash),
    ]),
  });
}

function buildMarkSettlementReadyInstruction({
  config,
  market,
  stakeCommitment,
  authority,
  encryptedPayoutHash,
  arciumComputation,
}) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: stakeCommitment, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:mark_settlement_ready'),
      Buffer.from(encryptedPayoutHash),
      arciumComputation.toBuffer(),
    ]),
  });
}

function buildMarkClaimedInstruction({
  config,
  market,
  stakeCommitment,
  userCastAccount,
  authority,
  claimAmountRaw,
}) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: stakeCommitment, isSigner: false, isWritable: true },
      { pubkey: config.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userCastAccount, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:mark_claimed'),
      writeU64(claimAmountRaw),
    ]),
  });
}

async function requestSettlementRegistration(config, stakeDraft, stakeResult) {
  const settlementCacheKey = stakeDraft.arciumPayload?.settlementCacheKey;
  if (!config.arciumStakeApiUrl || !settlementCacheKey || !stakeResult.stakeCommitment) {
    return null;
  }

  try {
    const response = await fetch(deriveSiblingApiUrl(config.arciumStakeApiUrl, '/settlement/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settlementCacheKey,
        stakeCommitment: stakeResult.stakeCommitment,
        marketAddress: stakeResult.market,
        owner: stakeDraft.arciumPayload?.walletAddress,
      }),
    });
    const details = await safeJson(response);
    if (!response.ok) {
      return { status: 'failed', error: details?.error || `Settlement registration failed with HTTP ${response.status}` };
    }
    return details;
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

async function requestPublicOddsUpdate(config, stakeDraft, stakeResult) {
  const marketAddress = parsePublicKey(stakeDraft.market?.marketAddress || stakeDraft.market?.id);
  if (!config.oddsApiUrl || stakeDraft.market?.type !== 'native' || !marketAddress) {
    return null;
  }

  try {
    const response = await fetch(config.oddsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketAddress: marketAddress.toBase58(),
        position: stakeDraft.position,
        amount: Number(stakeDraft.amount || 0),
        multiplier: 1,
        arciumComputation: stakeResult.arciumComputation,
      }),
    });

    const details = await safeJson(response);
    if (!response.ok) {
      return { status: 'failed', error: details?.error || `Odds keeper failed with HTTP ${response.status}` };
    }

    return details;
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

function deriveSiblingApiUrl(url, siblingPath) {
  if (!url) return '';
  if (url.startsWith('/')) return siblingPath;

  try {
    const parsed = new URL(url);
    parsed.pathname = siblingPath;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return siblingPath;
  }
}

async function sendWalletTransaction({ connection, walletProvider, tx }) {
  tx.feePayer = walletProvider.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  if (walletProvider.signAndSendTransaction) {
    const result = await walletProvider.signAndSendTransaction(tx);
    const signature = normalizeWalletSignature(typeof result === 'string' ? result : result.signature);
    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  if (walletProvider.sendTransaction) {
    const signature = normalizeWalletSignature(
      await walletProvider.sendTransaction(tx, connection, { preflightCommitment: 'confirmed' }),
    );
    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  if (!walletProvider.signTransaction) {
    throw new Error('Connected wallet does not support transaction signing.');
  }

  const signed = await walletProvider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

function normalizeWalletSignature(signature) {
  if (typeof signature === 'string') return signature;
  if (signature instanceof Uint8Array || Array.isArray(signature)) return base58Encode(signature);
  throw new Error('Wallet returned an unsupported transaction signature format.');
}

function base58Encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const source = Array.from(bytes);
  if (!source.length) return '';

  const digits = [0];
  for (const byte of source) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  for (const byte of source) {
    if (byte === 0) digits.push(0);
    else break;
  }

  return digits.reverse().map((digit) => alphabet[digit]).join('');
}

async function readCastBalance(connection, userCastAccount) {
  const account = await connection.getAccountInfo(userCastAccount);
  if (!account) return 0;
  const balance = await connection.getTokenAccountBalance(userCastAccount);
  return Number(balance.value.uiAmount || 0);
}

async function readRefillStatus(connection, faucetClaim) {
  const account = await connection.getAccountInfo(faucetClaim);
  if (!account) {
    return {
      claimedInitial: false,
      canRefill: false,
      secondsUntilRefill: 0,
    };
  }

  const lastRefillAt = Number(readI64(account.data, 49));
  const now = Math.floor(Date.now() / 1000);
  const secondsUntilRefill = Math.max(0, lastRefillAt + DAILY_REFILL_SECONDS - now);

  return {
    claimedInitial: true,
    canRefill: secondsUntilRefill === 0,
    secondsUntilRefill,
    lastRefillAt,
  };
}

function getUserCastAccount(castMint, owner) {
  return getAssociatedTokenAddressSync(castMint, owner, false, TOKEN_PROGRAM_ID);
}

function getFaucetClaimAddress(programId, owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('faucet-claim'), owner.toBuffer()],
    programId,
  )[0];
}

function getMarketAddress(programId, marketIdBytes) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), marketIdBytes],
    programId,
  )[0];
}

function getStakeCommitmentAddress({ programId, owner, market, stakeCommitmentHash }) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('stake'),
      owner.toBuffer(),
      market.toBuffer(),
      Buffer.from(stakeCommitmentHash),
    ],
    programId,
  )[0];
}

function getStakeMarketReference(programId, market) {
  const directKey = parsePublicKey(market?.id || market?.marketAddress);
  if (directKey) return directKey;

  const hash = hashToBytes(`${market?.conditionId || ''}:${market?.id || ''}:${market?.title || ''}`);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market-ref'), Buffer.from(hash)],
    programId,
  )[0];
}

function getArciumComputationReference(programId, arciumPayload, marketRef) {
  const computationAccount = parsePublicKey(arciumPayload?.accountHints?.computationAccount);
  if (computationAccount) return computationAccount;

  const hash = hashToBytes(`${marketRef.toBase58()}:${stableJson(arciumPayload || {})}`);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('arcium-ref'), Buffer.from(hash)],
    programId,
  )[0];
}

function parsePublicKey(value) {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function requirePublicKey(value, label) {
  const publicKey = parsePublicKey(value);
  if (!publicKey) {
    throw new Error(`${label} is missing from the Arcium stake payload.`);
  }
  return publicKey;
}

function bytesFromArray(value, expectedLength, label) {
  const bytes = Buffer.from(value || []);
  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes.`);
  }
  return bytes;
}

function bytesToBigIntLe(value) {
  const bytes = value || [];
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) + BigInt(bytes[index]);
  }
  return result;
}

function decodeMarketAccount(pubkey, data) {
  const discriminator = anchorDiscriminator('account:Market');
  const accountDiscriminator = Buffer.from(data.subarray(0, 8));
  if (!accountDiscriminator.equals(discriminator)) return null;

  try {
    const reader = createAccountReader(data, 8);
    const marketId = reader.u64().toString();
    const creator = reader.pubkey();
    const question = reader.string();
    const category = MARKET_CATEGORY_LABELS[reader.u8()] || 'Other';
    const type = MARKET_TYPE_LABELS[reader.u8()] || 'native';
    const resolutionTs = Number(reader.i64());
    reader.bytes(32);
    reader.optionPubkey();
    const oracleEnabled = Boolean(reader.u8());
    const status = reader.u8();
    const outcomePresent = reader.u8();
    const outcome = outcomePresent ? reader.u8() : null;
    const yes = reader.u8();
    const no = reader.u8();
    const publicVolume = reader.u64();
    reader.bytes(64);
    const arciumComputation = reader.optionPubkey();
    reader.u8();

    return {
      id: pubkey.toBase58(),
      marketAddress: pubkey.toBase58(),
      marketId,
      title: question,
      category,
      type,
      source: type === 'polymarket' ? 'Polymarket' : 'Native',
      yes,
      no,
      volume: Number(publicVolume / 1_000_000n),
      volumeDisplay: `${formatCastAmount(publicVolume)} $CAST`,
      ends: formatMarketDate(resolutionTs),
      resolutionTs,
      createdBy: creator,
      oracleEnabled,
      status: ['Open', 'Resolved', 'Cancelled'][status] || 'Open',
      outcome: outcome === null ? null : ['YES', 'NO', 'Cancelled'][outcome],
      arciumComputation,
      aggregateStatus: yes === 50 && no === 50 ? 'pending_mpc' : 'onchain',
      expert: oracleEnabled
        ? {
            count: 0,
            yesLean: 50,
            text: 'Expert oracle enabled. Encrypted opinions can be submitted after launch.',
            credentials: ['Crypto'],
          }
        : null,
    };
  } catch {
    return null;
  }
}

function decodeStakeCommitmentAccount(pubkey, data) {
  const discriminator = anchorDiscriminator('account:StakeCommitment');
  const accountDiscriminator = Buffer.from(data.subarray(0, 8));
  if (!accountDiscriminator.equals(discriminator)) return null;

  try {
    const reader = createAccountReader(data, 8);
    const user = reader.pubkey();
    const market = reader.pubkey();
    const stakeCommitmentHash = reader.bytes(32);
    const encryptedPayloadHash = reader.bytes(32);
    const encryptedPayoutHash = reader.optionBytes(32);
    const arciumComputation = reader.pubkey();
    const status = reader.u8();
    const createdAt = reader.i64();
    const bump = reader.u8();

    return {
      address: pubkey.toBase58(),
      user,
      market,
      stakeCommitmentHash: bytesToHex(stakeCommitmentHash),
      encryptedPayloadHash: bytesToHex(encryptedPayloadHash),
      encryptedPayoutHash: encryptedPayoutHash ? bytesToHex(encryptedPayoutHash) : '',
      arciumComputation,
      status,
      statusLabel: ['Stake Recorded', 'Settlement Ready', 'Claim Recorded', 'Cancelled'][status] || 'Unknown',
      createdAt,
      createdAtDisplay: formatMarketDate(Number(createdAt)),
      bump,
    };
  } catch {
    return null;
  }
}

function createAccountReader(data, initialOffset = 0) {
  let offset = initialOffset;
  const buffer = Buffer.from(data);

  return {
    u8() {
      const value = buffer.readUInt8(offset);
      offset += 1;
      return value;
    },
    u32() {
      const value = buffer.readUInt32LE(offset);
      offset += 4;
      return value;
    },
    u64() {
      const value = buffer.readBigUInt64LE(offset);
      offset += 8;
      return value;
    },
    i64() {
      const value = buffer.readBigInt64LE(offset);
      offset += 8;
      return value;
    },
    bytes(length) {
      const value = buffer.subarray(offset, offset + length);
      offset += length;
      return value;
    },
    pubkey() {
      return new PublicKey(this.bytes(32)).toBase58();
    },
    string() {
      const length = this.u32();
      const bytes = this.bytes(length);
      return new TextDecoder().decode(bytes);
    },
    optionPubkey() {
      const present = this.u8();
      return present ? this.pubkey() : null;
    },
    optionBytes(length) {
      const present = this.u8();
      return present ? this.bytes(length) : null;
    },
  };
}

function formatMarketDate(timestamp) {
  if (!timestamp) return 'TBD';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCastAmount(rawAmount) {
  const whole = Number(rawAmount / 1_000_000n);
  return whole.toLocaleString('en-US');
}

function anchorDiscriminator(name) {
  return syncSha256Discriminator(name);
}

function syncSha256Discriminator(name) {
  const words = sha256(new TextEncoder().encode(name));
  return Buffer.from(words).subarray(0, 8);
}

function readI64(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigInt64(0, true);
}

function formatCountdown(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function castUiAmountToRaw(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole || '0') * 10n ** BigInt(CAST_DECIMALS)
    + BigInt(fraction.padEnd(CAST_DECIMALS, '0'));
}

function hashToBytes(value) {
  return sha256(new TextEncoder().encode(String(value)));
}

function stableJson(value) {
  return JSON.stringify(value, (_, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.keys(item).sort().reduce((sorted, key) => {
        sorted[key] = item[key];
        return sorted;
      }, {});
    }
    return item;
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeCreateMarketData({
  marketId,
  question,
  category,
  marketType,
  resolutionTs,
  oracleEnabled,
  room,
  criteriaHash,
}) {
  return Buffer.concat([
    anchorDiscriminator('global:create_market'),
    writeU64(marketId),
    writeString(question),
    writeU8(MARKET_CATEGORY_VARIANTS[category] ?? MARKET_CATEGORY_VARIANTS.Other),
    writeU8(MARKET_TYPE_VARIANTS[marketType] ?? MARKET_TYPE_VARIANTS['Public Market']),
    writeI64(BigInt(resolutionTs)),
    writeU8(oracleEnabled ? 1 : 0),
    writeOptionPubkey(room),
    Buffer.from(criteriaHash),
  ]);
}

function makeMarketId() {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

function toResolutionTimestamp(dateValue, timeValue = '23:59') {
  if (!dateValue) return 0;
  const normalizedTime = /^\d{2}:\d{2}$/.test(timeValue || '') ? timeValue : '23:59';
  return Math.floor(new Date(`${dateValue}T${normalizedTime}:00`).getTime() / 1000);
}

function writeString(value) {
  const bytes = new TextEncoder().encode(value);
  return Buffer.concat([writeU32(bytes.length), Buffer.from(bytes)]);
}

function writeOptionPubkey(value) {
  if (!value) return writeU8(0);
  return Buffer.concat([writeU8(1), new PublicKey(value).toBuffer()]);
}

function writeU8(value) {
  return Buffer.from([value]);
}

function writeU32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function writeU64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function writeU128(value) {
  let next = BigInt(value);
  const bytes = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return bytes;
}

function writeI64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sha256(message) {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const l = message.length * 8;
  const withOne = message.length + 1;
  const zeroPad = (64 - ((withOne + 8) % 64)) % 64;
  const bytes = new Uint8Array(withOne + zeroPad + 8);
  bytes.set(message);
  bytes[message.length] = 0x80;
  new DataView(bytes.buffer).setUint32(bytes.length - 4, l, false);

  const w = new Uint32Array(64);
  for (let i = 0; i < bytes.length; i += 64) {
    const view = new DataView(bytes.buffer, i, 64);
    for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(j * 4, false);
    for (let j = 16; j < 64; j += 1) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let j = 0; j < 64; j += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[j] + w[j]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  h.forEach((word, index) => view.setUint32(index * 4, word, false));
  return out;
}

function rotr(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  RescueCipher,
  deserializeLE,
  getArciumProgramId,
  getClockAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  x25519,
} from '@arcium-hq/client';
import { quoteBinaryTrade } from '../src/lib/marketMaker.js';

loadLocalEnv();

const PORT = Number(process.env.ARCIUM_STAKE_SERVICE_PORT || 8787);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.ARCIUM_MXE_PROGRAM_ID || '';
const CLUSTER_OFFSET = Number(process.env.ARCIUM_CLUSTER_OFFSET || 456);
const STAKE_INSTRUCTION = process.env.ARCIUM_STAKE_INSTRUCTION || 'submit_private_stake_v2';
const SETTLEMENT_INSTRUCTION = process.env.ARCIUM_SETTLEMENT_INSTRUCTION || 'compute_private_settlement';
const FORECAST_PROGRAM_ID = process.env.FORECAST_PROGRAM_ID || process.env.VITE_FORECAST_PROGRAM_ID || '';
const FORECAST_CONFIG = process.env.FORECAST_CONFIG || process.env.VITE_FORECAST_CONFIG || '';
const ODDS_KEEPER_KEYPAIR_PATH = process.env.FORECAST_ODDS_KEEPER_KEYPAIR_PATH || '~/.config/solana/id.json';
const CAST_DECIMALS = 6n;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(MODULE_DIR, '..');
const DIST_DIR = resolve(PROJECT_ROOT, 'dist');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const pendingStakeSecrets = new Map();
const stakeSecretsByCommitment = new Map();

export function createForecastApiHandler() {
  return async function forecastApiHandler(req, res, next) {
    const route = req.url?.split('?')[0] || '';
    const handlesRoute = ['/stake', '/settlement/register', '/settlement', '/odds/update'].includes(route);

    if (!handlesRoute && next) {
      next();
      return;
    }

    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST' || !handlesRoute) {
      sendJson(res, 404, { error: 'Route not found. POST /stake, /settlement/register, /settlement, and /odds/update are available.' });
      return;
    }

    try {
      if ((route === '/stake' || route === '/settlement') && !PROGRAM_ID) {
        throw new Error('ARCIUM_MXE_PROGRAM_ID is required.');
      }

      const body = await readJson(req);
      let payload;
      if (route === '/stake') payload = await prepareStakePayload(body);
      if (route === '/settlement/register') payload = registerSettlementSecret(body);
      if (route === '/settlement') payload = await prepareSettlementPayload(body);
      if (route === '/odds/update') payload = await updatePublicOdds(body);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  };
}

export function createForecastAppHandler() {
  const apiHandler = createForecastApiHandler();

  return function forecastAppHandler(req, res) {
    apiHandler(req, res, () => serveFrontend(req, res));
  };
}

export function startForecastApiServer(port = PORT) {
  const server = http.createServer(createForecastAppHandler());
  server.listen(port, () => {
    const frontendStatus = existsSync(resolve(DIST_DIR, 'index.html'))
      ? `serving ${DIST_DIR}`
      : 'dist/ not found; run npm run build before production serving';
    console.log(`Forecast server listening on http://localhost:${port} (${frontendStatus})`);
    console.log(`API routes: http://localhost:${port}/stake, /settlement/register, /settlement, and /odds/update`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startForecastApiServer();
}

async function prepareStakePayload(body) {
  const position = normalizeOutcome(body.position);
  if (!position) throw new Error('Stake position must be YES or NO.');

  const settlementCacheKey = bytesToHex(randomBytes(16));
  const quote = quoteBinaryTrade({
    yesPercent: Number(body.market?.yes ?? 50),
    volume: Number(body.market?.volume ?? parseCastVolume(body.market?.volumeDisplay)),
    position,
    amount: Number(body.amount || 0),
  });
  const payoutIfWonRaw = castUiAmountToRaw(quote.payout);
  const normalizedBody = { ...body, position };
  pendingStakeSecrets.set(settlementCacheKey, {
    walletAddress: body.walletAddress,
    marketAddress: body.market?.marketAddress || body.market?.id || '',
    marketKey: body.market?.marketAddress || body.market?.id || body.market?.conditionId || body.market?.title || '',
    position,
    amount: Number(body.amount || 0),
    yesPercentAtStake: Number(body.market?.yes ?? 50),
    volumeAtStake: Number(body.market?.volume ?? parseCastVolume(body.market?.volumeDisplay)),
    payoutIfWonRaw: payoutIfWonRaw.toString(),
    payoutIfWon: rawCastToNumber(payoutIfWonRaw),
    multiplier: 1,
    createdAt: Date.now(),
  });

  const payload = await buildArciumPayload({
    body: normalizedBody,
    instruction: STAKE_INSTRUCTION,
    plaintext: buildStakePlaintext(normalizedBody),
    ciphertextFieldNames: ['marketId', 'position', 'amount', 'multiplier'],
  });

  return {
    ...payload,
    settlementCacheKey,
  };
}

function registerSettlementSecret(body) {
  const stakeCommitment = String(body.stakeCommitment || '').trim();
  const settlementCacheKey = String(body.settlementCacheKey || '').trim();
  const pending = pendingStakeSecrets.get(settlementCacheKey);

  if (!stakeCommitment) throw new Error('stakeCommitment is required for settlement registration.');
  if (!pending) throw new Error('Settlement secret cache entry was not found. Prepare the stake again.');

  stakeSecretsByCommitment.set(stakeCommitment, {
    ...pending,
    stakeCommitment,
    owner: body.owner || pending.walletAddress,
    marketAddress: body.marketAddress || pending.marketAddress,
    registeredAt: Date.now(),
  });
  pendingStakeSecrets.delete(settlementCacheKey);

  return {
    registered: true,
    stakeCommitment,
    arciumSettlementReady: true,
  };
}

async function prepareSettlementPayload(body) {
  const stakeCommitment = String(body.stakeCommitment?.address || body.stakeCommitment || '').trim();
  const secret = stakeSecretsByCommitment.get(stakeCommitment);
  if (!secret) {
    throw new Error('Private settlement inputs are not registered for this stake. New stakes register automatically while the Forecast server is running.');
  }

  const requestedMarket = body.market?.marketAddress || body.market?.id || body.marketAddress || '';
  if (requestedMarket && secret.marketAddress && requestedMarket !== secret.marketAddress) {
    throw new Error('Registered settlement secret does not belong to this market.');
  }

  const winningPosition = normalizeOutcome(body.winningPosition || body.outcome || body.market?.outcome);
  if (!winningPosition) throw new Error('Resolved YES/NO outcome is required before Arcium settlement.');

  const userPosition = normalizeOutcome(secret.position);
  if (!userPosition) throw new Error('Registered stake position is invalid. Re-stake while the Forecast server is running.');

  const won = userPosition === winningPosition;
  const payoutIfWonRaw = resolvePayoutIfWonRaw(secret, body, userPosition);
  const claimAmountRaw = won ? payoutIfWonRaw : 0n;
  const claimAmount = rawCastToNumber(claimAmountRaw);
  const settlementBody = {
    walletAddress: body.walletAddress,
    userPosition,
    winningPosition,
    amountRaw: payoutIfWonRaw.toString(),
    multiplier: secret.multiplier,
  };
  const payload = await buildArciumPayload({
    body: settlementBody,
    instruction: SETTLEMENT_INSTRUCTION,
    plaintext: buildSettlementPlaintext(settlementBody),
    ciphertextFieldNames: ['userPosition', 'winningPosition', 'amount', 'multiplier'],
  });

  return {
    ...payload,
    stakeCommitment,
    claimAmount,
    claimAmountRaw: claimAmountRaw.toString(),
    won,
    settlementInputHash: makeSettlementInputHash({
      stakeCommitment,
      winningPosition,
      claimAmountRaw: claimAmountRaw.toString(),
      computationAccount: payload.accountHints.computationAccount,
    }),
  };
}

async function buildArciumPayload({ body, instruction, plaintext, ciphertextFieldNames }) {
  const programId = new PublicKey(PROGRAM_ID);
  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = readonlyAnchorProvider(connection);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programId);
  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);
  const computationOffsetBytes = randomBytes(8);
  const ciphertext = cipher.encrypt(plaintext, nonce);
  const computationOffset = new BN(bytesToHex(computationOffsetBytes), 16);
  const compDefIndex = readCompDefIndex(getCompDefAccOffset(instruction));
  const signPdaAccount = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    programId,
  )[0];
  const ciphertextChunks = ciphertext.map((chunk) => Array.from(chunk));
  const ciphertextFields = ciphertextFieldNames.reduce((fields, name, index) => {
    fields[name] = ciphertextChunks[index];
    return fields;
  }, {});

  return {
    instruction,
    programId: PROGRAM_ID,
    clusterOffset: CLUSTER_OFFSET,
    queueable: true,
    walletAddress: body.walletAddress,
    computationOffset: bytesToHex(computationOffsetBytes),
    computationOffsetLe: Array.from(computationOffset.toArrayLike(Buffer, 'le', 8)),
    nonce: Array.from(nonce),
    nonceValue: deserializeLE(nonce).toString(),
    clientPublicKey: Array.from(clientPublicKey),
    ciphertext: ciphertextChunks,
    ciphertextFields,
    accountHints: {
      signPdaAccount: signPdaAccount.toString(),
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset).toString(),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET).toString(),
      mxeAccount: getMXEAccAddress(programId).toString(),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET).toString(),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET).toString(),
      compDefAccount: getCompDefAccAddress(programId, compDefIndex).toString(),
      poolAccount: getFeePoolAccAddress().toString(),
      clockAccount: getClockAccAddress().toString(),
      arciumProgram: getArciumProgramId().toString(),
    },
  };
}

async function updatePublicOdds(body) {
  if (!FORECAST_PROGRAM_ID || !FORECAST_CONFIG) {
    throw new Error('FORECAST_PROGRAM_ID and FORECAST_CONFIG are required for odds updates.');
  }

  const marketAddress = parsePublicKey(body.marketAddress || body.market?.marketAddress || body.market?.id);
  const arciumComputation = parsePublicKey(body.arciumComputation);
  if (!marketAddress) throw new Error('A real Forecast market address is required.');
  if (!arciumComputation) throw new Error('Arcium computation account is required.');

  const connection = new Connection(RPC_URL, 'confirmed');
  const authority = readKeypair(ODDS_KEEPER_KEYPAIR_PATH);
  const forecastProgramId = new PublicKey(FORECAST_PROGRAM_ID);
  const forecastConfig = new PublicKey(FORECAST_CONFIG);
  const marketAccount = await connection.getAccountInfo(marketAddress);
  if (!marketAccount) throw new Error('Forecast market account was not found on devnet.');

  const current = decodeForecastMarket(marketAccount.data);
  const next = computeNextOdds({
    currentYes: current.yes,
    currentNo: current.no,
    currentVolumeRaw: current.publicVolumeRaw,
    position: body.position,
    amount: body.amount,
    multiplier: body.multiplier,
  });
  const encryptedAggregate = makeAggregateCommitment({
    marketAddress,
    arciumComputation,
    yesPercent: next.yes,
    noPercent: next.no,
    publicVolumeDeltaRaw: next.publicVolumeDeltaRaw,
  });

  const tx = new Transaction().add(new TransactionInstruction({
    programId: forecastProgramId,
    keys: [
      { pubkey: forecastConfig, isSigner: false, isWritable: false },
      { pubkey: marketAddress, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:update_public_odds'),
      Buffer.from([next.yes]),
      Buffer.from([next.no]),
      writeU64(next.publicVolumeDeltaRaw),
      encryptedAggregate,
      arciumComputation.toBuffer(),
    ]),
  }));

  const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  });

  return {
    signature,
    marketAddress: marketAddress.toBase58(),
    yes: next.yes,
    no: next.no,
    publicVolumeRaw: next.publicVolumeRaw.toString(),
    publicVolumeDeltaRaw: next.publicVolumeDeltaRaw.toString(),
    volume: Number(next.publicVolumeRaw / 10n ** CAST_DECIMALS),
    volumeDisplay: `${formatCastVolume(next.publicVolumeRaw)} $CAST`,
    aggregateStatus: 'onchain',
  };
}

function buildStakePlaintext(body) {
  return [
    marketToFieldElement(body.market),
    body.position === 'YES' ? 1n : 0n,
    BigInt(Number(body.amount || 0)),
    1n,
  ];
}

function buildSettlementPlaintext(body) {
  return [
    body.userPosition === 'YES' ? 1n : 0n,
    body.winningPosition === 'YES' ? 1n : 0n,
    BigInt(body.amountRaw || 0),
    BigInt(Number(body.multiplier || 1)),
  ];
}

function normalizeOutcome(value) {
  const text = String(value || '').toUpperCase();
  if (text === 'YES') return 'YES';
  if (text === 'NO') return 'NO';
  return '';
}

function marketToFieldElement(market) {
  const seed = `${market?.conditionId || market?.id || ''}:${market?.title || ''}`;
  const hash = createHash('sha256').update(seed).digest();
  const fieldBytes = hash.subarray(0, 16);
  return BigInt(`0x${bytesToHex(fieldBytes)}`);
}

function decodeForecastMarket(data) {
  const buffer = Buffer.from(data);
  const discriminator = anchorDiscriminator('account:Market');
  if (!buffer.subarray(0, 8).equals(discriminator)) {
    throw new Error('Account is not a Forecast Market account.');
  }

  let offset = 8;
  offset += 8; // market_id
  offset += 32; // creator
  const questionLength = buffer.readUInt32LE(offset);
  offset += 4 + questionLength;
  offset += 1; // category
  offset += 1; // market_type
  offset += 8; // resolution_ts
  offset += 32; // criteria_hash
  const roomPresent = buffer.readUInt8(offset);
  offset += 1 + (roomPresent ? 32 : 0);
  offset += 1; // oracle_enabled
  offset += 1; // status
  const outcomePresent = buffer.readUInt8(offset);
  offset += 1 + (outcomePresent ? 1 : 0);
  const yes = buffer.readUInt8(offset);
  offset += 1;
  const no = buffer.readUInt8(offset);
  offset += 1;
  const publicVolumeRaw = buffer.readBigUInt64LE(offset);

  return { yes, no, publicVolumeRaw };
}

function computeNextOdds({ currentYes, currentVolumeRaw, position, amount }) {
  const amountRaw = castUiAmountToRaw(amount);
  const quote = quoteBinaryTrade({
    yesPercent: currentYes,
    volume: rawCastToNumber(currentVolumeRaw),
    position,
    amount,
  });
  const boundedYes = Math.max(1, Math.min(99, Math.round(quote.yes)));
  const publicVolumeRaw = currentVolumeRaw + amountRaw;

  return {
    yes: boundedYes,
    no: 100 - boundedYes,
    publicVolumeRaw,
    publicVolumeDeltaRaw: amountRaw,
  };
}

function rawCastToNumber(value) {
  return Number(value) / Number(10n ** CAST_DECIMALS);
}

function parseCastVolume(value = '') {
  if (!String(value).includes('$CAST')) return 0;
  const number = String(value).replace(/[^0-9.]/g, '');
  return Number(number || 0);
}

function castUiAmountToRaw(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return BigInt(Math.floor(value * Number(10n ** CAST_DECIMALS)));
  }

  const text = String(value ?? '0').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  const normalizedFraction = fraction
    .slice(0, Number(CAST_DECIMALS))
    .padEnd(Number(CAST_DECIMALS), '0');
  return BigInt(whole || '0') * 10n ** CAST_DECIMALS
    + BigInt(normalizedFraction || '0');
}

function resolvePayoutIfWonRaw(secret, body, userPosition) {
  const stored = BigInt(secret.payoutIfWonRaw || 0);
  if (stored > 0n || Number(secret.amount || 0) <= 0) return stored;

  const quote = quoteBinaryTrade({
    yesPercent: Number(secret.yesPercentAtStake ?? body.market?.yes ?? 50),
    volume: Number(secret.volumeAtStake ?? body.market?.volume ?? parseCastVolume(body.market?.volumeDisplay)),
    position: userPosition,
    amount: Number(secret.amount || 0),
  });

  return castUiAmountToRaw(quote.payout);
}

function makeAggregateCommitment(value) {
  return createHash('sha512')
    .update(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)))
    .digest()
    .subarray(0, 64);
}

function makeSettlementInputHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)))
    .digest('hex');
}

function parsePublicKey(value) {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function readKeypair(keypairPath) {
  const expandedPath = keypairPath.replace(/^~(?=$|\/)/, homedir());
  const secret = JSON.parse(readFileSync(expandedPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function anchorDiscriminator(name) {
  return createHash('sha256').update(name).digest().subarray(0, 8);
}

function writeU64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function formatCastVolume(rawAmount) {
  return Number(rawAmount / 10n ** CAST_DECIMALS).toLocaleString('en-US');
}

async function getMXEPublicKeyWithRetry(provider, programId, retries = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const publicKey = await getMXEPublicKey(provider, programId);
    if (publicKey) return publicKey;
    await wait(500);
  }

  throw new Error('Arcium MXE public key was not available. Check program deployment and cluster config.');
}

function readonlyAnchorProvider(connection) {
  const placeholder = PublicKey.default;
  return {
    connection,
    publicKey: placeholder,
    wallet: {
      publicKey: placeholder,
      signTransaction: async () => {
        throw new Error('The stake service only prepares encrypted payloads.');
      },
      signAllTransactions: async () => {
        throw new Error('The stake service only prepares encrypted payloads.');
      },
    },
    opts: { commitment: 'confirmed' },
  };
}

function readCompDefIndex(offsetBytes) {
  return Buffer.from(offsetBytes).readUInt32LE();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, (_, item) => (typeof item === 'bigint' ? item.toString() : item)));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function serveFrontend(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  if (!existsSync(resolve(DIST_DIR, 'index.html'))) {
    sendText(res, 503, 'Forecast frontend build not found. Run npm run build first.');
    return;
  }

  const url = new URL(req.url || '/', 'http://forecast.local');
  const route = decodeURIComponent(url.pathname);
  const candidatePath = resolve(DIST_DIR, `.${route}`);
  const isSafePath = candidatePath === DIST_DIR || candidatePath.startsWith(`${DIST_DIR}/`);
  if (!isSafePath) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const shouldServeAsset = route !== '/' && existsSync(candidatePath) && statSync(candidatePath).isFile();
  const filePath = shouldServeAsset ? candidatePath : resolve(DIST_DIR, 'index.html');
  const mimeType = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
  const body = readFileSync(filePath);

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Cache-Control': shouldServeAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadLocalEnv() {
  if (!existsSync('.env')) return;

  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

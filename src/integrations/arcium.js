const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

export function getArciumRuntimeConfig() {
  return {
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || DEFAULT_RPC_URL,
    stakeApiUrl: import.meta.env.VITE_ARCIUM_STAKE_API_URL || '',
    programId: import.meta.env.VITE_ARCIUM_MXE_PROGRAM_ID || '',
    clusterOffset: import.meta.env.VITE_ARCIUM_CLUSTER_OFFSET || '',
    stakeInstruction: import.meta.env.VITE_ARCIUM_STAKE_INSTRUCTION || 'submit_private_stake_v2',
    stakeCircuitUrl: import.meta.env.VITE_ARCIUM_STAKE_CIRCUIT_URL || '',
    stakeCircuitHash: import.meta.env.VITE_ARCIUM_STAKE_CIRCUIT_HASH || '',
  };
}

export async function prepareEncryptedStake({ market, position, amount, multiplier }) {
  const config = getArciumRuntimeConfig();

  if (!config.stakeApiUrl || !config.programId || !config.clusterOffset) {
    return {
      mode: 'configuration_required',
      message: 'Set VITE_ARCIUM_STAKE_API_URL, VITE_ARCIUM_MXE_PROGRAM_ID, and VITE_ARCIUM_CLUSTER_OFFSET to enable devnet Arcium stake submission.',
      config,
    };
  }

  const wallet = getBrowserSolanaWallet();
  const walletAddress = wallet?.publicKey?.toString?.();
  if (!walletAddress) {
    return {
      mode: 'wallet_required',
      message: 'Connect Phantom or Backpack before submitting an encrypted stake.',
      config,
    };
  }

  let response;
  try {
    response = await fetch(config.stakeApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        market: {
          id: market?.id,
          marketAddress: market?.marketAddress,
          title: market?.title,
          conditionId: market?.conditionId,
        },
        position,
        amount: Number(amount || 0),
        multiplier: 1,
      }),
    });
  } catch {
    throw new Error(`Cannot reach the local Arcium stake service at ${config.stakeApiUrl}. Start it with: node server/arciumStakeService.mjs`);
  }

  if (!response.ok) {
    const details = await safeJson(response);
    throw new Error(details?.error || `Arcium stake service failed with HTTP ${response.status}`);
  }

  return {
    mode: 'encrypted_payload',
    config,
    payload: await response.json(),
  };
}

export async function buildBrowserStakePreview({ market, position, amount, multiplier }) {
  const seed = `${market?.conditionId || market?.id || ''}:${market?.title || ''}`;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const fieldBytes = bytes.slice(0, 16);
  return {
    marketField: bytesToHex(fieldBytes),
    position: position === 'YES' ? 1 : 0,
    amount: Number(amount || 0),
    multiplier: 1,
  };
}

export async function connectInjectedWallet(walletName) {
  const provider = getInjectedProvider(walletName);
  if (!provider?.connect) {
    return null;
  }

  const result = await provider.connect();
  const publicKey = result?.publicKey || provider.publicKey;
  if (!publicKey) return null;

  return {
    provider,
    publicKey,
    address: publicKey.toString(),
  };
}

function getBrowserSolanaWallet() {
  return getInjectedProvider('Phantom') || getInjectedProvider('Backpack');
}

function getInjectedProvider(walletName) {
  if (walletName === 'Backpack') {
    return window.backpack?.solana || window.backpack || null;
  }

  if (walletName === 'Phantom') {
    return window.phantom?.solana || window.solana || null;
  }

  return window.solana || window.backpack?.solana || null;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

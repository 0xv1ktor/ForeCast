import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Navbar, Toast, WalletModal } from './components/Primitives.jsx';
import { emptyWallet, markets } from './data/forecastData.js';
import {
  createForecastMarket,
  fetchForecastNativeMarkets,
  fetchMarketStakeCommitments,
  fetchUserStakeCommitments,
  getInjectedForecastWallet,
  queueArciumSettlement,
  requestDailyCastRefill,
  resolveForecastMarket,
  settleAndPayStake,
  submitForecastStake,
  syncForecastWallet,
} from './integrations/forecast.js';
import { fetchForecastPolymarkets } from './integrations/polymarket.js';
import { walletProviderWithPublicKey } from './lib/async.js';
import { quoteBinaryTrade } from './lib/marketMaker.js';
import {
  CreateMarketPage,
  LandingPage,
  LeaderboardPage,
  MarketDetailPage,
  MarketsPage,
  ProfilePage,
  RoomDetailPage,
  RoomsPage,
} from './pages/index.js';
import { prepareEncryptedStake } from './integrations/arcium.js';

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [walletModal, setWalletModal] = useState(false);
  const [connected, setConnected] = useState(() => localStorage.getItem('forecast-wallet-connected') === 'true');
  const [wallet, setWallet] = useState(() => localStorage.getItem('forecast-wallet') || emptyWallet);
  const [balance, setBalance] = useState(() => Number(localStorage.getItem('forecast-balance') || (localStorage.getItem('forecast-wallet-connected') ? 1000 : 0)));
  const [connectStatus, setConnectStatus] = useState('');
  const [selectedWallet, setSelectedWallet] = useState('');
  const [toast, setToast] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [refillStatus, setRefillStatus] = useState(null);
  const [refillLoading, setRefillLoading] = useState(false);
  const [livePolymarkets, setLivePolymarkets] = useState([]);
  const [createdMarkets, setCreatedMarkets] = useState(() => readCachedCreatedMarkets());
  const [onchainMarkets, setOnchainMarkets] = useState([]);
  const [marketOddsOverrides, setMarketOddsOverrides] = useState(() => readCachedMarketOddsOverrides());
  const [polymarketStatus, setPolymarketStatus] = useState('idle');
  const [polymarketError, setPolymarketError] = useState('');

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (connected) {
      localStorage.setItem('forecast-wallet-connected', 'true');
      localStorage.setItem('forecast-wallet', wallet);
      localStorage.setItem('forecast-balance', String(balance));
    }
  }, [connected, wallet, balance]);

  useEffect(() => {
    const controller = new AbortController();
    setPolymarketStatus('loading');
    fetchForecastPolymarkets({ limit: 10, signal: controller.signal })
      .then((items) => {
        setLivePolymarkets(items);
        setPolymarketStatus(items.length ? 'ready' : 'fallback');
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setPolymarketError(error.message);
        setPolymarketStatus('fallback');
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    fetchForecastNativeMarkets()
      .then((items) => {
        if (active) setOnchainMarkets(items);
      })
      .catch((error) => {
        console.warn('Forecast onchain market fetch failed', error);
      });

    return () => {
      active = false;
    };
  }, []);

  function navigate(to) {
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function beginConnect() {
    setWalletModal(true);
    setConnectStatus('');
  }

  function showToast(message, type = 'success') {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }

  async function chooseWallet(name) {
    setSelectedWallet(name);
    setConnectStatus('Opening wallet approval...');

    try {
      const provider = getInjectedForecastWallet(name);
      const connectionResult = provider?.connect ? await provider.connect() : null;
      const publicKey = connectionResult?.publicKey || provider?.publicKey;

      if (provider && publicKey) {
        const connectedProvider = provider.publicKey ? provider : walletProviderWithPublicKey(provider, publicKey);
        setWalletProvider(connectedProvider);
        setWallet(publicKey.toString());
        setConnected(true);
        setConnectStatus('Syncing Forecast faucet...');
        const sync = await syncForecastWallet({
          walletProvider: connectedProvider,
          onStatus: setConnectStatus,
        });
        setBalance(sync.balance);
        setRefillStatus(sync.refill);
        setWalletModal(false);
        setConnectStatus('');
        showToast(sync.claimedInitialNow ? 'Wallet connected. 1,000 $CAST minted from Forecast faucet.' : 'Wallet connected. $CAST balance synced from devnet.');
        return;
      }

      throw new Error(`${name} wallet was not found. Install or unlock ${name}, then try again.`);
    } catch (error) {
      setConnectStatus('');
      showToast(error.message || 'Wallet connection failed', 'warning');
    }
  }

  async function handleDailyRefill() {
    if (!walletProvider) {
      showToast('Daily refill needs a real Phantom or Backpack wallet.', 'warning');
      return;
    }

    try {
      setRefillLoading(true);
      const result = await requestDailyCastRefill(walletProvider);
      setBalance(result.balance);
      setRefillStatus(result.refill);
      showToast('Daily refill complete. 100 $CAST added to your wallet.');
    } catch (error) {
      showToast(error.message || 'Daily refill failed', 'warning');
    } finally {
      setRefillLoading(false);
    }
  }

  async function handleCopyAddress() {
    if (!wallet) return;

    try {
      await navigator.clipboard.writeText(wallet);
      showToast('Wallet address copied.');
    } catch {
      showToast('Could not copy address from this browser.', 'warning');
    }
  }

  async function handleDisconnectWallet() {
    try {
      await walletProvider?.disconnect?.();
    } catch {
      // Some injected wallets do not expose disconnect, so local app state still clears below.
    }

    localStorage.removeItem('forecast-wallet-connected');
    localStorage.removeItem('forecast-wallet');
    localStorage.removeItem('forecast-balance');
    setConnected(false);
    setWalletProvider(null);
    setWallet(emptyWallet);
    setBalance(0);
    setRefillStatus(null);
    setSelectedWallet('');
    showToast('Wallet disconnected.');
  }

  async function handleCreateMarket(marketDraft) {
    if (!walletProvider) {
      throw new Error('Create Market needs a real Phantom or Backpack wallet.');
    }

    const result = await createForecastMarket(walletProvider, marketDraft);
    let createdMarket = buildCreatedMarketCard({ result, marketDraft });
    const seedAmount = Number(marketDraft.seedAmount || 0);

    if (seedAmount > 0) {
      try {
        const arciumResult = await prepareEncryptedStake({
          market: createdMarket,
          position: marketDraft.seedSide || 'YES',
          amount: seedAmount,
          multiplier: 1,
        });

        if (arciumResult.mode !== 'encrypted_payload') {
          throw new Error(arciumResult.message);
        }

        const seedStakeResult = await submitForecastStake(walletProvider, {
          market: createdMarket,
          position: marketDraft.seedSide || 'YES',
          amount: String(seedAmount),
          multiplier: 1,
          arciumPayload: arciumResult.payload,
        });
        setBalance(seedStakeResult.balance);
        createdMarket = {
          ...createdMarket,
          ...buildOddsUpdateFromStakeResult(createdMarket, {
            market: createdMarket,
            position: marketDraft.seedSide || 'YES',
            amount: String(seedAmount),
            multiplier: 1,
          }, seedStakeResult),
        };
      } catch (error) {
        showToast(`Market created, but seed liquidity needs Arcium service: ${error.message}`, 'warning');
      }
    }

    setCreatedMarkets((items) => {
      const next = dedupeMarkets([createdMarket, ...items]);
      cacheCreatedMarkets(next);
      return next;
    });
    setOnchainMarkets((items) => dedupeMarkets([createdMarket, ...items]));
    showToast('Market created on Solana devnet.');
    navigate(`/markets/${createdMarket.id}`);
    return result;
  }

  async function handleSubmitStake(stakeDraft) {
    if (!walletProvider) {
      throw new Error('Stake submission needs a real Phantom or Backpack wallet.');
    }

    const result = await submitForecastStake(walletProvider, stakeDraft);
    setBalance(result.balance);
    const oddsUpdate = buildOddsUpdateFromStakeResult(stakeDraft.market, stakeDraft, result);
    if (oddsUpdate) {
      setMarketOddsOverrides((items) => {
        const next = {
          ...items,
          [getMarketKey(stakeDraft.market)]: oddsUpdate,
        };
        cacheMarketOddsOverrides(next);
        return next;
      });
    }
    showToast('Encrypted stake recorded on Solana devnet.');
    return result;
  }

  async function handleLoadUserStakeCommitments(market) {
    if (!walletProvider) {
      throw new Error('Connect Phantom or Backpack before checking settlement.');
    }

    return fetchUserStakeCommitments(walletProvider, market);
  }

  async function handleLoadMarketStakeCommitments(market) {
    if (!walletProvider) {
      throw new Error('Connect the market creator wallet before loading settlement commitments.');
    }

    return fetchMarketStakeCommitments(walletProvider, market);
  }

  async function handleQueueArciumSettlement(settlementDraft) {
    if (!walletProvider) {
      throw new Error('Connect the market creator wallet before running Arcium settlement.');
    }

    const result = await queueArciumSettlement(walletProvider, settlementDraft);
    showToast(`Arcium settlement queued. Tx ${result.signature.slice(0, 6)}...${result.signature.slice(-4)}.`);
    return result;
  }

  async function handleSettleAndPayStake(settlementDraft) {
    if (!walletProvider) {
      throw new Error('Connect the market creator wallet before settling payout.');
    }

    const result = await settleAndPayStake(walletProvider, settlementDraft);
    showToast(`Payout settled. Tx ${result.signature.slice(0, 6)}...${result.signature.slice(-4)}.`);
    return result;
  }

  async function handleResolveMarket(market, outcome) {
    if (!walletProvider) {
      throw new Error('Connect the market creator wallet before resolving.');
    }

    const result = await resolveForecastMarket(walletProvider, market, outcome);
    const update = {
      status: result.status,
      outcome: result.outcome,
      resolutionSignature: result.signature,
    };

    setCreatedMarkets((items) => {
      const next = items.map((item) => (
        getMarketKey(item) === getMarketKey(market) ? { ...item, ...update } : item
      ));
      cacheCreatedMarkets(next);
      return next;
    });
    setOnchainMarkets((items) => items.map((item) => (
      getMarketKey(item) === getMarketKey(market) ? { ...item, ...update } : item
    )));
    showToast(`Market resolved as ${result.outcome}.`);
    return result;
  }

  const appMarkets = useMemo(() => {
    const nativeMarkets = markets.filter((market) => market.type === 'native');
    const polymarketMarkets = livePolymarkets.length
      ? livePolymarkets
      : markets.filter((market) => market.type === 'polymarket');
    const createdAndOnchainMarkets = dedupeMarkets([...createdMarkets, ...onchainMarkets]);

    return [
      ...createdAndOnchainMarkets,
      ...nativeMarkets.slice(0, 3),
      ...polymarketMarkets.slice(0, 3),
      ...nativeMarkets.slice(3),
      ...polymarketMarkets.slice(3),
    ].map((market) => applyMarketOddsOverride(market, marketOddsOverrides));
  }, [createdMarkets, onchainMarkets, livePolymarkets, marketOddsOverrides]);

  const route = useMemo(() => {
    if (path === '/') return <LandingPage navigate={navigate} markets={appMarkets} />;
    if (path === '/markets') return <MarketsPage navigate={navigate} markets={appMarkets} polymarketStatus={polymarketStatus} polymarketError={polymarketError} />;
    if (path.startsWith('/markets/')) return <MarketDetailPage id={path.split('/')[2]} markets={appMarkets} balance={balance} connected={Boolean(walletProvider)} wallet={wallet} onConnect={beginConnect} onStake={handleSubmitStake} onResolveMarket={handleResolveMarket} onLoadUserStakeCommitments={handleLoadUserStakeCommitments} onLoadMarketStakeCommitments={handleLoadMarketStakeCommitments} onQueueArciumSettlement={handleQueueArciumSettlement} onSettleAndPayStake={handleSettleAndPayStake} />;
    if (path === '/create') return <CreateMarketPage connected={connected} walletProvider={walletProvider} onConnect={beginConnect} onCreateMarket={handleCreateMarket} />;
    if (path.startsWith('/profile/')) return <ProfilePage address={decodeURIComponent(path.split('/')[2] || '')} balance={balance} connected={connected} />;
    if (path === '/rooms') return <RoomsPage navigate={navigate} />;
    if (path.startsWith('/rooms/')) return <RoomDetailPage id={path.split('/')[2]} navigate={navigate} markets={appMarkets} />;
    if (path === '/leaderboard') return <LeaderboardPage />;
    return <LandingPage navigate={navigate} markets={appMarkets} />;
  }, [path, appMarkets, polymarketStatus, polymarketError, connected, walletProvider, wallet, balance]);

  return (
    <div className="app-shell">
      <Navbar
        navigate={navigate}
        connected={connected}
        wallet={wallet}
        balance={balance}
        onConnect={beginConnect}
        onCopyAddress={handleCopyAddress}
        onDisconnect={handleDisconnectWallet}
        onRefill={handleDailyRefill}
        refillStatus={refillStatus}
        refillLoading={refillLoading}
      />
      <AnimatePresence mode="wait">
        <motion.main key={path} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {route}
        </motion.main>
      </AnimatePresence>
      <AnimatePresence>
        {walletModal && (
          <WalletModal
            status={connectStatus}
            selectedWallet={selectedWallet}
            onChoose={chooseWallet}
            onClose={() => {
              if (!connectStatus) setWalletModal(false);
            }}
          />
        )}
      </AnimatePresence>
      <Toast toast={toast} />
    </div>
  );
}

function buildCreatedMarketCard({ result, marketDraft }) {
  const ends = new Date(Number(result.resolutionTs || 0) * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const seedAmount = Number(marketDraft.seedAmount || 0);
  const seedSide = marketDraft.seedSide || 'YES';
  const seedOdds = seedAmount > 0
    ? buildStakeOddsUpdate({ type: 'native', yes: 50, no: 50, volume: 0, volumeDisplay: '0 $CAST' }, {
        position: seedSide,
        amount: String(seedAmount),
        multiplier: 1,
      })
    : null;

  return {
    id: result.marketAddress,
    marketId: result.marketId,
    title: result.question,
    category: marketDraft.category,
    type: 'native',
    source: 'Native',
    yes: seedOdds?.yes ?? 50,
    no: seedOdds?.no ?? 50,
    volume: seedOdds?.volume ?? 0,
    volumeDisplay: seedOdds?.volumeDisplay ?? '0 $CAST',
    aggregateStatus: seedOdds?.aggregateStatus,
    ends,
    resolutionTs: result.resolutionTs,
    createdBy: result.creator,
    signature: result.signature,
    expert: marketDraft.oracleEnabled
      ? {
          count: 0,
          yesLean: 50,
          text: 'Expert oracle enabled. Encrypted opinions can be submitted after launch.',
          credentials: marketDraft.credentials?.length ? marketDraft.credentials : ['Crypto'],
        }
      : null,
  };
}

function dedupeMarkets(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.marketAddress || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyMarketOddsOverride(market, overrides) {
  const update = overrides[getMarketKey(market)];
  if (update) return { ...market, ...update, aggregateStatus: update.aggregateStatus || 'local_preview' };
  if (market.type === 'native' && Number(market.yes) === 50 && Number(market.no) === 50) {
    return { ...market, aggregateStatus: 'pending_mpc' };
  }
  return market;
}

function buildOddsUpdateFromStakeResult(market, stakeDraft, stakeResult) {
  if (stakeResult.oddsUpdate?.yes !== undefined) {
    return {
      yes: stakeResult.oddsUpdate.yes,
      no: stakeResult.oddsUpdate.no,
      volume: stakeResult.oddsUpdate.volume,
      volumeDisplay: stakeResult.oddsUpdate.volumeDisplay,
      aggregateStatus: 'onchain',
      oddsSignature: stakeResult.oddsUpdate.signature,
    };
  }

  return buildStakeOddsUpdate(market, stakeDraft);
}

function buildStakeOddsUpdate(market, stakeDraft) {
  if (!market || market.type !== 'native') return null;

  const amount = Math.max(0, Number(stakeDraft.amount || 0));
  if (!amount) return null;

  const visibleVolume = Math.max(Number(market.volume || 0), parseCastVolume(market.volumeDisplay));
  const quote = quoteBinaryTrade({
    yesPercent: market.yes,
    volume: visibleVolume,
    position: stakeDraft.position,
    amount,
  });
  const volume = visibleVolume + amount;

  return {
    yes: roundPercent(quote.yes),
    no: roundPercent(quote.no),
    volume,
    volumeDisplay: `${formatCastVolume(volume)} $CAST`,
    aggregateStatus: 'local_preview',
  };
}

function getMarketKey(market = {}) {
  return market.marketAddress || market.id || market.marketId || market.conditionId || market.title || 'unknown';
}

function parseCastVolume(value = '') {
  if (!String(value).includes('$CAST')) return 0;
  const number = String(value).replace(/[^0-9.]/g, '');
  return Number(number || 0);
}

function formatCastVolume(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US');
}

function roundPercent(value) {
  return Math.max(0, Math.min(100, Number(Number(value || 0).toFixed(1))));
}

function readCachedCreatedMarkets() {
  try {
    return JSON.parse(localStorage.getItem('forecast-created-markets') || '[]');
  } catch {
    return [];
  }
}

function cacheCreatedMarkets(items) {
  localStorage.setItem('forecast-created-markets', JSON.stringify(items.slice(0, 25)));
}

function readCachedMarketOddsOverrides() {
  try {
    return JSON.parse(localStorage.getItem('forecast-market-odds-overrides') || '{}');
  } catch {
    return {};
  }
}

function cacheMarketOddsOverrides(items) {
  localStorage.setItem('forecast-market-odds-overrides', JSON.stringify(items));
}

export default App;

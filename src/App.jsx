import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Navbar, Toast, WalletModal } from './components/Primitives.jsx';
import { fakeWallet, markets } from './data/forecastData.js';
import {
  createForecastMarket,
  getInjectedForecastWallet,
  requestDailyCastRefill,
  syncForecastWallet,
} from './integrations/forecast.js';
import { fetchForecastPolymarkets } from './integrations/polymarket.js';
import { wait, walletProviderWithPublicKey } from './lib/async.js';
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

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [walletModal, setWalletModal] = useState(false);
  const [connected, setConnected] = useState(() => localStorage.getItem('forecast-wallet-connected') === 'true');
  const [wallet, setWallet] = useState(() => localStorage.getItem('forecast-wallet') || fakeWallet);
  const [balance, setBalance] = useState(() => Number(localStorage.getItem('forecast-balance') || (localStorage.getItem('forecast-wallet-connected') ? 1000 : 0)));
  const [connectStatus, setConnectStatus] = useState('');
  const [selectedWallet, setSelectedWallet] = useState('');
  const [toast, setToast] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [refillStatus, setRefillStatus] = useState(null);
  const [refillLoading, setRefillLoading] = useState(false);
  const [livePolymarkets, setLivePolymarkets] = useState([]);
  const [createdMarkets, setCreatedMarkets] = useState([]);
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

      setWallet(fakeWallet);
      setConnected(true);
      setBalance(0);
      setConnectStatus('Demo wallet active. Simulating 1,000 $CAST faucet...');
      await wait(650);
      let nextBalance = 0;
      const timer = window.setInterval(() => {
        nextBalance += 125;
        setBalance(Math.min(nextBalance, 1000));
        if (nextBalance >= 1000) {
          window.clearInterval(timer);
          setWalletModal(false);
          setConnectStatus('');
          showToast('Demo wallet active. 1,000 $CAST faucet balance prepared. Daily refill limit: 100 $CAST.');
        }
      }, 90);
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

  async function handleCreateMarket(marketDraft) {
    if (!walletProvider) {
      throw new Error('Create Market needs a real Phantom or Backpack wallet.');
    }

    const result = await createForecastMarket(walletProvider, marketDraft);
    const createdMarket = buildCreatedMarketCard({ result, marketDraft });
    setCreatedMarkets((items) => [createdMarket, ...items]);
    showToast('Market created on Solana devnet.');
    navigate(`/markets/${createdMarket.id}`);
    return result;
  }

  const appMarkets = useMemo(() => {
    const nativeMarkets = markets.filter((market) => market.type === 'native');
    const polymarketMarkets = livePolymarkets.length
      ? livePolymarkets
      : markets.filter((market) => market.type === 'polymarket');

    return [
      ...createdMarkets,
      ...nativeMarkets.slice(0, 3),
      ...polymarketMarkets.slice(0, 3),
      ...nativeMarkets.slice(3),
      ...polymarketMarkets.slice(3),
    ];
  }, [createdMarkets, livePolymarkets]);

  const route = useMemo(() => {
    if (path === '/') return <LandingPage navigate={navigate} markets={appMarkets} />;
    if (path === '/markets') return <MarketsPage navigate={navigate} markets={appMarkets} polymarketStatus={polymarketStatus} polymarketError={polymarketError} />;
    if (path.startsWith('/markets/')) return <MarketDetailPage id={path.split('/')[2]} markets={appMarkets} />;
    if (path === '/create') return <CreateMarketPage connected={connected} walletProvider={walletProvider} onConnect={beginConnect} onCreateMarket={handleCreateMarket} />;
    if (path.startsWith('/profile/')) return <ProfilePage address={decodeURIComponent(path.split('/')[2] || fakeWallet)} />;
    if (path === '/rooms') return <RoomsPage navigate={navigate} />;
    if (path.startsWith('/rooms/')) return <RoomDetailPage id={path.split('/')[2]} navigate={navigate} markets={appMarkets} />;
    if (path === '/leaderboard') return <LeaderboardPage />;
    return <LandingPage navigate={navigate} markets={appMarkets} />;
  }, [path, appMarkets, polymarketStatus, polymarketError, connected, walletProvider]);

  return (
    <div className="app-shell">
      <Navbar
        navigate={navigate}
        connected={connected}
        wallet={wallet}
        balance={balance}
        onConnect={beginConnect}
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
  const ends = new Date(`${marketDraft.resolutionDate}T23:59:59Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return {
    id: result.marketAddress,
    marketId: result.marketId,
    title: result.question,
    category: marketDraft.category,
    type: 'native',
    source: 'Native',
    yes: 50,
    no: 50,
    volume: 0,
    volumeDisplay: '0 $CAST',
    ends,
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

export default App;

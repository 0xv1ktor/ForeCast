import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { tierDetails } from '../data/forecastData.js';
import { formatCast, truncateAddress } from '../lib/formatters.js';

export function AppLink({ to, navigate, children, className = '', onClick }) {
  const active = typeof window !== 'undefined' && (
    window.location.pathname === to ||
    (to !== '/' && window.location.pathname.startsWith(to))
  );

  return (
    <a
      href={to}
      className={`${className} ${active ? 'active' : ''}`.trim()}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function ArciumBadge({ short = false, permissioned = false }) {
  return (
    <span className="arcium-badge">
      <LockIcon />
      {permissioned ? 'Arcium MPC' : short ? 'MPC active' : 'Encrypted computation'}
    </span>
  );
}

export function LockIcon({ className = '' }) {
  return (
    <svg
      className={`lock-icon ${className}`.trim()}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 7V5.7C5 3.8 6.3 2.5 8 2.5s3 1.3 3 3.2V7" />
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" />
      <path d="M8 9.4v1.8" />
    </svg>
  );
}

export function CastAmount({ value, encrypted = false }) {
  if (encrypted) {
    return <span className="cast encrypted">[ENCRYPTED]</span>;
  }

  return (
    <span className="cast">
      {value}
      <span>$CAST</span>
    </span>
  );
}

export function SourceBadge({ source }) {
  const isPolymarket = source?.includes('Polymarket');
  const className = isPolymarket ? 'source-badge polymarket' : 'source-badge native';
  return <span className={className}>{source}</span>;
}

export function CategoryPill({ category }) {
  return <span className={`category-pill category-${category.toLowerCase().replaceAll(' ', '-')}`}>{category}</span>;
}

export function ProbabilityDisplay({ yes, change, large = false }) {
  const probability = Number(yes || 0);
  const delta = Number(change ?? deriveDailyChange({ yes: probability }));
  const neutral = Math.abs(probability - 50) <= 5;
  const className = neutral ? 'warning' : probability > 50 ? 'yes' : 'no';

  return (
    <div className={`probability-display ${large ? 'probability-large' : ''}`}>
      <strong className={className}>{formatPercent(probability)}%</strong>
      <span>{delta >= 0 ? '+' : ''}{formatPercent(delta)}% 24h</span>
    </div>
  );
}

export function Sparkline({ market, height = 32 }) {
  const points = makeSparklinePoints(market);
  const first = points[0];
  const last = points[points.length - 1];
  const trend = Math.abs(last - first) < 2 ? 'flat' : last > first ? 'up' : 'down';
  const width = 160;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1, max - min);
  const d = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point - min) / range) * (height - 4) - 2;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg className={`sparkline sparkline-${trend}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function OddsBar({ yes, no, large = false }) {
  return (
    <div className={`odds-wrap ${large ? 'odds-large' : ''}`}>
      <div className="odds-row">
        <span className="yes">YES {formatPercent(yes)}%</span>
        <span className="no">NO {formatPercent(no)}%</span>
      </div>
      <div className="odds-bar" aria-label={`Yes ${yes} percent, No ${no} percent`}>
        <motion.span
          className="odds-yes"
          initial={{ width: 0 }}
          animate={{ width: `${yes}%` }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        />
        <motion.span
          className="odds-no"
          initial={{ width: 0 }}
          animate={{ width: `${no}%` }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

export function MarketCard({ market, navigate }) {
  const change = deriveDailyChange(market);

  return (
    <motion.button
      className="market-card"
      onClick={() => navigate(`/markets/${market.id}`)}
    >
      <div className="card-topline">
        <CategoryPill category={market.category} />
        <SourceBadge source={market.live ? 'Polymarket Live' : market.source} />
      </div>
      <h3>{market.title}</h3>
      <OddsBar yes={market.yes} no={market.no} />
      <ProbabilityDisplay yes={market.yes} change={change} />
      <Sparkline market={market} />
      <div className="market-card-bottom">
        <span>{market.volumeDisplay}</span>
        <span className={change >= 0 ? 'daily-change positive' : 'daily-change negative'}>{change >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(change))}%</span>
        <span>{market.ends}</span>
        <LockIcon className="lock-mark" />
      </div>
      {market.aggregateStatus === 'pending_mpc' && <span className="market-state warning">Pending aggregate</span>}
      {market.aggregateStatus === 'local_preview' && <span className="market-state">Local preview</span>}
    </motion.button>
  );
}

export function HeroMarketCard({ market, navigate }) {
  const change = deriveDailyChange(market);

  return (
    <article className="hero-market-card">
      <button className="hero-market-main" type="button" onClick={() => navigate(`/markets/${market.id}`)}>
        <div className="card-topline">
          <CategoryPill category={market.category} />
          <SourceBadge source={market.live ? 'Polymarket Live' : market.source} />
          <ArciumBadge short />
        </div>
        <h2>{market.title}</h2>
        <ProbabilityDisplay yes={market.yes} change={change} large />
        <OddsBar yes={market.yes} no={market.no} large />
        <Sparkline market={market} height={42} />
        <div className="market-card-bottom">
          <span>{market.volumeDisplay}</span>
          <span className={change >= 0 ? 'daily-change positive' : 'daily-change negative'}>{change >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(change))}% 24h</span>
          <span>Closes {market.ends}</span>
        </div>
        {market.aggregateStatus === 'pending_mpc' && <span className="market-state warning">Pending aggregate</span>}
        {market.aggregateStatus === 'local_preview' && <span className="market-state">Local preview</span>}
      </button>
      <div className="hero-trade-buttons">
        <button className="trade-button trade-yes" type="button" onClick={() => navigate(`/markets/${market.id}`)}>BUY YES</button>
        <button className="trade-button trade-no" type="button" onClick={() => navigate(`/markets/${market.id}`)}>BUY NO</button>
      </div>
    </article>
  );
}

export function ExpertSignalBar({ signal }) {
  if (!signal) return null;

  return (
    <motion.div
      className="expert-signal"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.15 }}
    >
      <div className="expert-head">
        <span>Expert Oracle</span>
        <LockIcon />
      </div>
      <div className="expert-track">
        <motion.span
          className="expert-fill"
          initial={{ width: 0 }}
          whileInView={{ width: `${signal.yesLean}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        />
        <span className="expert-marker" style={{ left: `${signal.yesLean}%` }} />
      </div>
      <div className="expert-meta">
        <span>{signal.count} experts - {signal.yesLean}% lean YES</span>
        <span>Encrypted by Arcium</span>
      </div>
    </motion.div>
  );
}

export function AccuracyBadge({ tier = 'Gold', large = false }) {
  const detail = tierDetails[tier];

  return (
    <motion.div
      className={`accuracy-badge badge-${tier.toLowerCase()} ${large ? 'accuracy-large' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <span>{detail.symbol}</span>
      <strong>{tier.toUpperCase()}</strong>
      <small>{detail.range} accuracy</small>
    </motion.div>
  );
}

export function ConvictionSlider({ value, onChange }) {
  const colors = {
    1: '#7A8190',
    2: '#378ADD',
    3: '#EF9F27',
    4: '#EF9F27',
    5: '#E24B4A',
  };
  const labels = {
    1: 'Uncertain',
    2: 'Leaning',
    3: 'Confident',
    4: 'Very Confident',
    5: 'Certain',
  };
  const percent = ((value - 1) / 4) * 100;

  return (
    <div className="conviction-control">
      <div className="conviction-value" style={{ color: colors[value] }}>
        {value}x
      </div>
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={value}
        aria-label="Conviction multiplier"
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          '--slider-color': colors[value],
          '--slider-progress': `${percent}%`,
        }}
      />
      <div className="conviction-footer">
        <span>{labels[value]}</span>
        <span>Higher conviction = amplified payout if correct. Higher loss if wrong.</span>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function SectionHeader({ title, text, action }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      {action}
    </div>
  );
}

export function IntegrationStatus({ status, error, readyText, loadingText, fallbackText }) {
  if (!status || status === 'idle') return null;

  const text = status === 'ready' ? readyText : status === 'loading' ? loadingText : fallbackText;

  return (
    <div className={`integration-status integration-${status}`}>
      <span>{status === 'ready' ? 'LIVE' : status === 'loading' ? 'SYNC' : 'FALLBACK'}</span>
      <p>{text}{error ? ` - ${error}` : ''}</p>
    </div>
  );
}

export function Toast({ toast }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          className={`toast toast-${toast.type || 'success'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {toast.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Navbar({
  navigate,
  connected,
  wallet,
  balance,
  onConnect,
  onCopyAddress,
  onDisconnect,
  onRefill,
  onHowItWorks,
  refillStatus,
  refillLoading,
}) {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const portfolioPath = connected ? `/profile/${wallet}` : '/profile/disconnected';

  return (
    <nav className="navbar">
      <AppLink to="/" navigate={navigate} className="logo"><span />ForeCast</AppLink>
      <div className="nav-links">
        <AppLink to="/markets" navigate={navigate}>Markets</AppLink>
        <AppLink to={portfolioPath} navigate={navigate}>Portfolio</AppLink>
        <AppLink to="/leaderboard" navigate={navigate}>Leaderboard</AppLink>
        <AppLink to="/rooms" navigate={navigate}>Activity</AppLink>
        <button type="button" onClick={onHowItWorks}>How It Works</button>
      </div>
      <div className="wallet-zone">
        {connected ? (
          <>
            <span className="balance-pill"><b>◎ {formatCast(balance)}</b><small>$CAST</small></span>
            <ArciumBadge short />
            <div className="wallet-menu-wrap">
              <button
                className={`avatar-dot avatar-button ${walletMenuOpen ? 'active' : ''}`}
                type="button"
                aria-expanded={walletMenuOpen}
                aria-label="Open wallet menu"
                onClick={() => setWalletMenuOpen((open) => !open)}
              >
                {wallet?.slice(0, 2)}
              </button>
              <AnimatePresence>
                {walletMenuOpen && (
                  <motion.div
                    className="wallet-menu"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <AppLink
                      to={`/profile/${wallet}`}
                      navigate={navigate}
                      className="wallet-menu-address"
                      onClick={() => setWalletMenuOpen(false)}
                    >
                      {truncateAddress(wallet)}
                    </AppLink>
                    <button
                      className="wallet-menu-action wallet-action"
                      type="button"
                      onClick={() => {
                        onCopyAddress?.();
                        setWalletMenuOpen(false);
                      }}
                    >
                      Copy address
                    </button>
                    <button
                      className="wallet-menu-action"
                      type="button"
                      onClick={() => {
                        onRefill?.();
                        setWalletMenuOpen(false);
                      }}
                      disabled={refillLoading}
                      title={refillStatus?.canRefill ? 'Request 100 $CAST daily refill' : 'Daily refill unlocks after 24 hours'}
                    >
                      {refillLoading ? 'Refilling...' : 'Refill 100 $CAST'}
                    </button>
                    <button
                      className="wallet-menu-action wallet-disconnect"
                      type="button"
                      onClick={() => {
                        onDisconnect?.();
                        setWalletMenuOpen(false);
                      }}
                    >
                      Disconnect
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <button className="btn btn-secondary" onClick={onConnect}>Connect Wallet</button>
        )}
      </div>
    </nav>
  );
}

export function HowItWorksModal({ onClose }) {
  const [index, setIndex] = useState(0);
  const slide = HOW_IT_WORKS_SLIDES[index];
  const atStart = index === 0;
  const atEnd = index === HOW_IT_WORKS_SLIDES.length - 1;

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="modal how-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">How It Works</p>
            <h2>{slide.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close how it works">×</button>
        </div>

        <div className="how-progress" aria-label={`Step ${index + 1} of ${HOW_IT_WORKS_SLIDES.length}`}>
          {HOW_IT_WORKS_SLIDES.map((item, itemIndex) => (
            <button
              key={item.step}
              type="button"
              className={itemIndex === index ? 'active' : ''}
              onClick={() => setIndex(itemIndex)}
              aria-label={`Open ${item.title}`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.section
            key={slide.step}
            className="how-slide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="how-step">{slide.step}</div>
            <p>{slide.text}</p>
            <div className="how-points">
              {slide.points.map((point) => (
                <div key={point}>
                  <LockIcon />
                  <span>{point}</span>
                </div>
              ))}
            </div>
            {slide.arcium && (
              <div className="how-arcium">
                <ArciumBadge />
                <span>{slide.arcium}</span>
              </div>
            )}
          </motion.section>
        </AnimatePresence>

        <div className="how-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={atStart}>
            Back
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => (atEnd ? onClose() : setIndex((value) => Math.min(HOW_IT_WORKS_SLIDES.length - 1, value + 1)))}
          >
            {atEnd ? 'Close' : 'Next'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function WalletModal({ status, selectedWallet, onChoose, onClose }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Wallet</p>
            <h2>Connect to Forecast</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close wallet modal">×</button>
        </div>

        {status ? (
          <div className="wallet-progress">
            <div className="mpc-dots"><span /><span /><span /></div>
            <h3>{selectedWallet}</h3>
            <p>{status}</p>
          </div>
        ) : (
          <div className="wallet-options">
            <button onClick={() => onChoose('Phantom')}>
              <span className="wallet-icon phantom">P</span>
              <span>
                <strong>Phantom</strong>
                <small>Solana devnet signer</small>
              </span>
            </button>
            <button onClick={() => onChoose('Backpack')}>
              <span className="wallet-icon backpack">B</span>
              <span>
                <strong>Backpack</strong>
                <small>Solana devnet signer</small>
              </span>
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

const HOW_IT_WORKS_SLIDES = [
  {
    step: '01',
    title: 'Forecast Markets',
    text: 'ForeCast is a $CAST prediction market on Solana devnet. Native markets accept private stakes; Polymarket markets are imported as live public signals until you convert them.',
    points: [
      'Browse active markets and current probabilities.',
      'Create native markets with a clear resolution date and criteria.',
      'Convert a Polymarket signal into a ForeCast-native market before trading.',
    ],
  },
  {
    step: '02',
    title: 'Private Staking',
    text: 'When you trade on a native market, the app sends your side and amount through the Arcium stake computation before ForeCast records the commitment on Solana.',
    points: [
      'Your wallet signs the transaction.',
      'ForeCast records a private stake commitment.',
      'Public odds move from aggregate signal, not exposed individual positions.',
    ],
    arcium: 'The individual stake amount and side are handled through Arcium MPC instead of being displayed in the UI.',
  },
  {
    step: '03',
    title: 'Settlement',
    text: 'The market creator posts the final outcome after the resolution time. Then the payout computation uses the encrypted commitments to produce claimable results.',
    points: [
      'Creator resolves YES, NO, or cancels against the stated criteria.',
      'Arcium settlement computes payout references from private commitments.',
      'ForeCast records and pays results from the settlement output.',
    ],
    arcium: 'The settlement circuit is separate from the stake circuit because it solves a different job after the market is resolved.',
  },
  {
    step: '04',
    title: 'What Stays Public',
    text: 'The market question, odds, volume, outcome, and transaction references are public. Individual positions, stake amounts, and private reputation history stay hidden.',
    points: [
      'Public: market metadata, aggregate odds, final outcome.',
      'Private: individual side, amount, and participation history.',
      'Demo links show Forecast accounts and Arcium computation accounts on devnet explorer.',
    ],
    arcium: 'ForeCast uses Arcium where private computation matters: stake privacy now, settlement privacy after resolution.',
  },
];

export function Footer({ navigate }) {
  return (
    <footer className="footer">
      <div>
        <button className="footer-logo" onClick={() => navigate('/')}>ForeCast</button>
        <p>The market knows.</p>
      </div>
      <div className="footer-links">
        <button onClick={() => navigate('/markets')}>Markets</button>
        <button onClick={() => navigate('/create')}>Create</button>
        <button onClick={() => navigate('/rooms')}>Rooms</button>
        <button onClick={() => navigate('/leaderboard')}>Leaderboard</button>
        <button>Docs</button>
      </div>
      <div className="footer-meta">
        <span>Built on Solana. Computed with Arcium.</span>
        <span>© 2026 ForeCast. Open source on GitHub.</span>
      </div>
    </footer>
  );
}

export function TopTraders({ rows = [] }) {
  return (
    <section className="sidebar-panel">
      <div className="panel-head">
        <h2>Leaderboard</h2>
        <span>soon</span>
      </div>
      <div className="leaderboard-mini">
        {rows.length ? (
          rows.slice(0, 5).map(([tier, address, winRate], index) => (
            <div className="leaderboard-row" key={`${address}-${index}`}>
              <span className="rank">{index + 1}</span>
              <strong>{address}</strong>
              <em>{winRate}</em>
            </div>
          ))
        ) : (
          <div className="empty-state compact">
            Coming soon. Private reputation opens after resolved markets publish Arcium aggregates.
          </div>
        )}
      </div>
    </section>
  );
}

export function LiveMovers({ markets = [], navigate }) {
  return (
    <section className="sidebar-panel">
      <div className="panel-head">
        <h2>Live Movers</h2>
        <span>24h</span>
      </div>
      <div className="movers-list">
        {markets.slice(0, 6).map((market) => {
          const change = deriveDailyChange(market);
          return (
            <button
              className={`mover-card ${change > 10 ? 'hot-up' : change < -10 ? 'hot-down' : ''}`}
              key={market.id}
              onClick={() => navigate(`/markets/${market.id}`)}
            >
              <span>{market.title}</span>
              <strong className={market.yes >= 50 ? 'yes' : 'no'}>{formatPercent(market.yes)}%</strong>
              <em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{formatPercent(change)}%</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function deriveDailyChange(market = {}) {
  const seed = String(market.id || market.title || market.yes || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const magnitude = ((seed % 1900) / 100) - 9.5;
  return Number(magnitude.toFixed(1));
}

function formatPercent(value) {
  return Number(value || 0).toFixed(1);
}

function makeSparklinePoints(market = {}) {
  const seed = String(market.id || market.title || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const base = Number(market.yes || 50);
  return Array.from({ length: 16 }, (_, index) => {
    const wave = Math.sin((seed + index * 17) / 11) * 7;
    const drift = (index - 7) * ((seed % 9) - 4) * 0.22;
    return Math.max(4, Math.min(96, base + wave + drift));
  });
}

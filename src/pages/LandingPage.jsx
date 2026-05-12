import { motion } from 'framer-motion';
import {
  Footer,
  HeroMarketCard,
  LockIcon,
  LiveMovers,
  MarketCard,
  SectionHeader,
  TopTraders,
} from '../components/Primitives.jsx';
import { leaderboardRows } from '../data/forecastData.js';
import { formatCast } from '../lib/formatters.js';

const fadeUp = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

export function LandingPage({ navigate, markets }) {
  const featured = markets.slice(0, 6);
  const heroMarket = featured[0];
  const nativeMarkets = markets.filter((market) => market.type === 'native');
  const polymarketMarkets = markets.filter((market) => market.type === 'polymarket');
  const castVolume = nativeMarkets.reduce((sum, market) => sum + Number(market.volume || 0), 0);

  return (
    <>
      <section className="terminal-hero">
        <motion.div className="terminal-hero-copy" initial="hidden" animate="visible" variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.15 } },
        }}>
          <motion.p className="eyebrow" variants={fadeUp}>ForeCast / Solana prediction markets</motion.p>
          <motion.h1 variants={fadeUp}>The market knows.</motion.h1>
          <motion.p variants={fadeUp}>Encrypted conviction markets for traders who read signal before consensus. Positions stay private; probabilities move in public.</motion.p>
          <motion.div variants={fadeUp} className="hero-actions">
            <button className="btn btn-primary btn-large" onClick={() => navigate('/markets')}>Browse Markets</button>
            <button className="btn btn-secondary btn-large" onClick={() => navigate('/create')}>Create Market</button>
          </motion.div>
        </motion.div>
      </section>

      <section className="stats-bar terminal-stats">
        <Stat number={formatCast(markets.length)} label="Loaded Markets" />
        <Stat number={`◎ ${formatCast(castVolume)}`} label="$CAST Staked" />
        <Stat number={formatCast(nativeMarkets.length)} label="Native Markets" />
        <Stat number={formatCast(polymarketMarkets.length)} label="Polymarket Signals" />
      </section>

      <section className="markets-dashboard">
        <main className="markets-main">
          <SectionHeader title="Featured Market" text="Largest active signal by Forecast volume." />
          {heroMarket ? (
            <HeroMarketCard market={heroMarket} navigate={navigate} />
          ) : (
            <div className="empty-state">
              No live markets loaded yet. Connect devnet or create the first Forecast market.
            </div>
          )}

          <SectionHeader title="Active Markets" action={<button className="text-link" onClick={() => navigate('/markets')}>All markets</button>} />
          {featured.length > 1 ? (
            <div className="market-grid">
              {featured.slice(1).map((market) => <MarketCard key={market.id} market={market} navigate={navigate} />)}
            </div>
          ) : (
            <div className="empty-state compact">Active market list will populate from Forecast devnet and Polymarket.</div>
          )}
        </main>
        <aside className="markets-sidebar">
          <TopTraders rows={leaderboardRows} />
          <LiveMovers markets={markets} navigate={navigate} />
          <section className="sidebar-panel encrypted-panel">
            <div className="panel-head">
              <h2>Encrypted Compute</h2>
              <span>ARCIUM</span>
            </div>
            <p><LockIcon /> Stakes, expert inputs, and reputation records are computed privately. Only aggregate market signals leave the MPC layer.</p>
          </section>
        </aside>
      </section>

      <section className="page-section compact-section" id="how-it-works">
        <SectionHeader title="Mechanism" text="Public odds. Private positions. Computed on encrypted inputs." />
        <div className="three-grid">
          <InfoCard title="01 / Position" text="Choose YES or NO and size conviction in $CAST." />
          <InfoCard title="02 / Compute" text="Arcium processes private stake state without exposing user-side detail." />
          <InfoCard title="03 / Signal" text="ForeCast publishes probabilities, aggregate expert lean, and reputation tiers." />
        </div>
      </section>

      <Footer navigate={navigate} />
    </>
  );
}

function Stat({ number, label }) {
  return (
    <div className="stat">
      <strong>{number}</strong>
      <span>{label}</span>
    </div>
  );
}

function InfoCard({ title, text }) {
  return (
    <motion.article className="info-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </motion.article>
  );
}

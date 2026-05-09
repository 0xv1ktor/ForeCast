import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { prepareEncryptedStake } from '../integrations/arcium.js';
import { formatCast, truncateAddress } from '../lib/formatters.js';
import { wait } from '../lib/async.js';
import {
  ArciumBadge,
  CategoryPill,
  ConvictionSlider,
  ExpertSignalBar,
  OddsBar,
  ProbabilityDisplay,
  SectionHeader,
  Sparkline,
  SourceBadge,
} from '../components/Primitives.jsx';

export function MarketDetailPage({ id, markets }) {
  const market = markets.find((item) => item.id === id) || markets[0];
  const [position, setPosition] = useState('YES');
  const [multiplier, setMultiplier] = useState(3);
  const [amount, setAmount] = useState('250');
  const [phase, setPhase] = useState('');
  const [success, setSuccess] = useState('');
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [stakeNoticeType, setStakeNoticeType] = useState('success');
  const [activity, setActivity] = useState([
    '🔒 Anonymous staked [ENCRYPTED] on YES with 3x conviction - 2 min ago',
    '🔒 Anonymous staked [ENCRYPTED] on NO with 1x conviction - 5 min ago',
    '🔒 [ENCRYPTED] position added - 8 min ago',
    '🔒 Anonymous staked [ENCRYPTED] on YES with 2x conviction - 12 min ago',
  ]);
  const numericAmount = Number(amount || 0);
  const potential = numericAmount * multiplier;

  async function submitStake() {
    if (!numericAmount || phase) return;
    setSuccess('');
    setStakeNoticeType('success');

    try {
      setPhase('Preparing stake...');
      await wait(450);
      setPhase('Encrypting with Arcium MPC...');
      const arciumResult = await prepareEncryptedStake({ market, position, amount: numericAmount, multiplier });

      if (arciumResult.mode !== 'encrypted_payload') {
        setPhase('');
        setStakeNoticeType('warning');
        setSuccess(`🔒 ${arciumResult.message}`);
        return;
      }

      setPhase('Preparing Solana account hints...');
      await wait(450);
      setPhase('MPC Computing...');
      await wait(700);
      setPhase('');
      setSuccess('🔒 Stake encrypted with Arcium client. Devnet transaction payload is ready for the Forecast MXE program.');
      setActivity((items) => [`🔒 Anonymous prepared [ENCRYPTED] ${position} stake with ${multiplier}x conviction - just now`, ...items.slice(0, 5)]);
    } catch (error) {
      setPhase('');
      setStakeNoticeType('warning');
      setSuccess(`Arcium setup needs attention: ${error.message}`);
    }
  }

  return (
    <div className="page detail-page">
      <div className="detail-top">
        <div>
          <div className="card-topline detail-meta">
            <CategoryPill category={market.category} />
            <SourceBadge source={market.live ? 'Polymarket Live' : market.source} />
            <ArciumBadge />
          </div>
          <h1>{market.title}</h1>
          <div className="market-facts">
            <span>Ends {market.ends}</span>
            <span>{market.volumeDisplay} volume</span>
            <span>Created by {truncateAddress(market.createdBy)}</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="odds-panel">
            <ProbabilityDisplay yes={market.yes} large />
            <OddsBar yes={market.yes} no={market.no} large />
            <p className="encrypted-note">{market.volumeDisplay} staked</p>
            <p className="subtle">All positions encrypted - Powered by Arcium MPC</p>
          </section>

          <section className="history-panel">
            <SectionHeader title="Price History" text="Probability movement across the latest market window." />
            <Sparkline market={market} height={140} />
          </section>

          {market.expert && (
            <section className="oracle-detail">
              <div className="oracle-title">
                <h2>🔒 Expert Oracle Signal</h2>
                <span>{market.expert.text}</span>
              </div>
              <ExpertSignalBar signal={market.expert} />
              <div className="credential-row">
                {market.expert.credentials.map((credential) => <span key={credential}>{credential}</span>)}
              </div>
              <p className="teal-note">🔒 Individual opinions encrypted by Arcium. Aggregate only.</p>
            </section>
          )}

          <section className="activity-panel">
            <SectionHeader title="Recent Trades" text="Amounts are intentionally private where encrypted." />
            <div className="trades-table">
              <div className="trade-row trade-head">
                <span>Time</span>
                <span>Side</span>
                <span>Amount</span>
                <span>Shares</span>
                <span>User</span>
              </div>
              {[
                ['2m', 'YES', '🔒', '3x', 'anon'],
                ['5m', 'NO', '🔒', '1x', 'anon'],
                ['8m', 'YES', '🔒', '2x', 'anon'],
                ['12m', 'YES', '🔒', '2x', 'anon'],
              ].map(([time, side, tradeAmount, shares, user], index) => (
                <div className="trade-row" key={`${time}-${side}-${index}`}>
                  <span>{time}</span>
                  <strong className={side === 'YES' ? 'yes' : 'no'}>{side}</strong>
                  <span>{tradeAmount}</span>
                  <span>{shares}</span>
                  <span>{user}</span>
                </div>
              ))}
            </div>
            <div className="activity-list">
              <AnimatePresence initial={false}>
                {activity.map((item) => (
                  <motion.div key={item} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    {item}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>

          <section className="criteria-panel">
            <button type="button" onClick={() => setCriteriaOpen((open) => !open)}>
              <span>Resolution Criteria</span>
              <strong>{criteriaOpen ? '-' : '+'}</strong>
            </button>
            {criteriaOpen && (
              <p>
                Market resolves according to the stated source and closes on {market.ends}. Individual
                stake data remains private while the final public outcome is posted to Forecast.
              </p>
            )}
          </section>
        </div>

        <aside className="stake-card order-panel">
          <p className="eyebrow">Conviction Stake</p>
          <h2>Order Panel</h2>

          <div className="stake-step">
            <label>1. Choose position</label>
            <div className="position-toggle">
              <button className={position === 'YES' ? 'selected yes-button' : 'yes-button'} onClick={() => setPosition('YES')}>YES</button>
              <button className={position === 'NO' ? 'selected no-button' : 'no-button'} onClick={() => setPosition('NO')}>NO</button>
            </div>
          </div>

          <div className="stake-step">
            <label>2. Conviction Multiplier</label>
            <ConvictionSlider value={multiplier} onChange={setMultiplier} />
          </div>

          <div className="stake-step">
            <label>3. Enter $CAST amount</label>
            <div className="amount-input">
              <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} />
              <span>$CAST</span>
            </div>
            <div className="balance-line">Balance: 1,247 $CAST</div>
            <div className="quick-amounts">
              {['100', '250', '500'].map((item) => <button key={item} onClick={() => setAmount(item)}>{item}</button>)}
              <button onClick={() => setAmount('1247')}>MAX</button>
            </div>
          </div>

          <div className="payout-preview">
            <div><span>If correct</span><strong>+{formatCast(potential)} $CAST</strong></div>
            <div><span>If wrong</span><strong>-{formatCast(numericAmount)} $CAST</strong></div>
          </div>

          <button className={`btn btn-full submit-stake ${position === 'YES' ? 'trade-yes' : 'trade-no'}`} onClick={submitStake} disabled={Boolean(phase)}>
            {phase ? (
              <>
                {phase}
                <span className="mini-dots"><i /><i /><i /></span>
              </>
            ) : 'Stake with Arcium'}
          </button>
          {success && <motion.div className={`success-box ${stakeNoticeType === 'warning' ? 'warning-box' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{success}</motion.div>}
        </aside>
      </div>
    </div>
  );
}

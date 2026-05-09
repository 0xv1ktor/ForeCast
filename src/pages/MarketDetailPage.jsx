import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { prepareEncryptedStake } from '../integrations/arcium.js';
import { formatCast, truncateAddress } from '../lib/formatters.js';
import { wait } from '../lib/async.js';
import { getDisplayOutcomePrices, quoteBinaryTrade } from '../lib/marketMaker.js';
import {
  ArciumBadge,
  CategoryPill,
  ExpertSignalBar,
  OddsBar,
  ProbabilityDisplay,
  SectionHeader,
  Sparkline,
  SourceBadge,
} from '../components/Primitives.jsx';

export function MarketDetailPage({ id, markets, balance = 0, connected = false, onConnect, onStake }) {
  const market = markets.find((item) => item.id === id) || markets[0];
  const [position, setPosition] = useState('YES');
  const [amount, setAmount] = useState('250');
  const [phase, setPhase] = useState('');
  const [success, setSuccess] = useState('');
  const [stakeSignature, setStakeSignature] = useState('');
  const [stakeProof, setStakeProof] = useState(null);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [stakeNoticeType, setStakeNoticeType] = useState('success');
  const [activity, setActivity] = useState([]);

  if (!market) {
    return (
      <div className="page detail-page">
        <section className="empty-state">
          Market not found. Create a native Forecast market or wait for live Polymarket discovery to finish.
        </section>
      </div>
    );
  }

  const numericAmount = Number(amount || 0);
  const displayPrices = getDisplayOutcomePrices(market.yes);
  const quote = quoteBinaryTrade({
    yesPercent: market.yes,
    volume: market.volume,
    position,
    amount: numericAmount,
  });
  const yesPrice = displayPrices.yes;
  const noPrice = displayPrices.no;
  const estimatedShares = quote.shares;

  function addAmount(delta) {
    setAmount(String(Math.max(0, Number(amount || 0) + delta)));
  }

  async function submitStake() {
    if (!numericAmount || phase) return;
    setSuccess('');
    setStakeSignature('');
    setStakeProof(null);
    setStakeNoticeType('success');

    if (!connected || !onStake) {
      setStakeNoticeType('warning');
      setSuccess('Connect Phantom or Backpack before submitting an encrypted stake.');
      onConnect?.();
      return;
    }

    try {
      setPhase('Preparing stake...');
      await wait(450);
      setPhase('Encrypting with Arcium MPC...');
      const arciumResult = await prepareEncryptedStake({ market, position, amount: numericAmount, multiplier: 1 });

      if (arciumResult.mode !== 'encrypted_payload') {
        setPhase('');
        setStakeNoticeType('warning');
        setSuccess(`🔒 ${arciumResult.message}`);
        return;
      }

      setPhase('Depositing $CAST to Forecast vault...');
      const stakeResult = await onStake({
        market,
        position,
        amount,
        multiplier: 1,
        arciumPayload: arciumResult.payload,
      });

      setPhase('Recording encrypted stake commitment...');
      await wait(300);
      setPhase('');
      setStakeSignature(stakeResult.signature);
      setStakeProof(stakeResult);
      setSuccess(`🔒 Position encrypted and recorded on Solana. Tx ${truncateAddress(stakeResult.signature)}.`);
      setActivity((items) => [{ time: 'now', side: position }, ...items.slice(0, 5)]);
    } catch (error) {
      setPhase('');
      setStakeNoticeType('warning');
      setSuccess(error.message || 'Encrypted stake submission failed.');
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
            <span>{market.type === 'polymarket' ? 'Polymarket ID' : 'Created by'} {truncateAddress(market.createdBy)}</span>
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
            {market.aggregateStatus === 'pending_mpc' && (
              <p className="aggregate-note warning">Public odds pending Arcium aggregate update.</p>
            )}
            {market.aggregateStatus === 'local_preview' && (
              <p className="aggregate-note">Local aggregate preview. Onchain odds update still pending.</p>
            )}
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
              {activity.length ? (
                activity.map((item, index) => (
                  <div className="trade-row" key={`${item.time}-${item.side}-${index}`}>
                    <span>{item.time}</span>
                    <strong className={item.side === 'YES' ? 'yes' : 'no'}>{item.side}</strong>
                    <span>🔒</span>
                    <span>🔒</span>
                    <span>anon</span>
                  </div>
                ))
              ) : (
                <div className="empty-state compact">
                  No public trades yet in this browser session. Stake amounts and wallet positions stay private.
                </div>
              )}
            </div>
            {activity.length > 0 && (
              <div className="activity-list">
                <AnimatePresence initial={false}>
                  {activity.map((item, index) => (
                    <motion.div key={`${item.time}-${item.side}-${index}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      🔒 Anonymous bought [ENCRYPTED] {item.side} - {item.time}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          <section className="criteria-panel">
            <button type="button" onClick={() => setCriteriaOpen((open) => !open)}>
              <span>Resolution Criteria</span>
              <strong>{criteriaOpen ? '-' : '+'}</strong>
            </button>
            {criteriaOpen && (
              <p>
                MVP resolution is performed by the Forecast authority after checking the stated criteria
                and source. Creator-only resolution is intentionally avoided unless a dispute window or
                oracle flow is added. Individual stake data remains private while the final public outcome
                is posted to Forecast.
              </p>
            )}
          </section>
        </div>

        <aside className="stake-card order-panel">
          <div className="trade-ticket-head">
            <div className="trade-tabs">
              <button type="button" className="active">Buy</button>
            </div>
            <button className="order-type-button" type="button">Market ▾</button>
          </div>

          <div className="outcome-price-grid">
            <button
              className={position === 'YES' ? 'selected yes-button' : 'yes-button'}
              type="button"
              onClick={() => setPosition('YES')}
            >
              <span>Yes</span>
              <strong>{formatCentPrice(yesPrice)}</strong>
            </button>
            <button
              className={position === 'NO' ? 'selected no-button' : 'no-button'}
              type="button"
              onClick={() => setPosition('NO')}
            >
              <span>No</span>
              <strong>{formatCentPrice(noPrice)}</strong>
            </button>
          </div>

          <div className="trade-amount-row">
            <label>Amount</label>
            <strong>{formatCast(numericAmount)} <span>$CAST</span></strong>
          </div>
          <div className="amount-input compact-amount-input">
            <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} />
            <span>$CAST</span>
          </div>
          <div className="quick-amounts trade-increments">
            {[10, 50, 100, 500].map((item) => (
              <button key={item} type="button" onClick={() => addAmount(item)}>+{item}</button>
            ))}
            <button type="button" onClick={() => setAmount(String(Math.max(0, Math.floor(balance))))}>MAX</button>
          </div>
          <div className="balance-line">Balance: {formatCast(balance)} $CAST</div>

          <div className="trade-summary">
            <div><span>Avg price</span><strong>{formatCentPrice(quote.avgPrice)}</strong></div>
            <div><span>Est. shares</span><strong>{formatCast(estimatedShares)}</strong></div>
          </div>

          <div className="payout-preview">
            <div><span>Est. payout if correct</span><strong>{formatCast(quote.payout)} $CAST</strong></div>
            <div><span>Max loss</span><strong>{formatCast(numericAmount)} $CAST</strong></div>
          </div>

          <button className="btn btn-full trade-execute" onClick={submitStake} disabled={Boolean(phase)}>
            {phase ? (
              <>
                {phase}
                <span className="mini-dots"><i /><i /><i /></span>
              </>
            ) : 'Trade'}
          </button>
          {success && (
            <motion.div className={`success-box ${stakeNoticeType === 'warning' ? 'warning-box' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <span>{success}</span>
              {stakeSignature && (
                <div className="stake-proof-links">
                  <a href={`https://explorer.solana.com/tx/${stakeSignature}?cluster=devnet`} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                  {stakeProof?.arciumMxeProgramId && (
                    <a href={explorerAccount(stakeProof.arciumMxeProgramId)} target="_blank" rel="noreferrer">
                      Arcium MXE {truncateAddress(stakeProof.arciumMxeProgramId)}
                    </a>
                  )}
                  {stakeProof?.arciumProgramId && (
                    <a href={explorerAccount(stakeProof.arciumProgramId)} target="_blank" rel="noreferrer">
                      Arcium core {truncateAddress(stakeProof.arciumProgramId)}
                    </a>
                  )}
                  {stakeProof?.arciumCompDefAccount && (
                    <a href={explorerAccount(stakeProof.arciumCompDefAccount)} target="_blank" rel="noreferrer">
                      Circuit definition {truncateAddress(stakeProof.arciumCompDefAccount)}
                    </a>
                  )}
                  {stakeProof?.arciumComputation && (
                    <a href={explorerAccount(stakeProof.arciumComputation)} target="_blank" rel="noreferrer">
                      Computation {truncateAddress(stakeProof.arciumComputation)}
                    </a>
                  )}
                  {stakeProof?.stakeCommitment && (
                    <a href={explorerAccount(stakeProof.stakeCommitment)} target="_blank" rel="noreferrer">
                      Forecast commitment {truncateAddress(stakeProof.stakeCommitment)}
                    </a>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </aside>
      </div>
    </div>
  );
}

function explorerAccount(address) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function formatCentPrice(value) {
  const price = Number(value || 0);
  const formatted = Number.isInteger(price) ? price.toFixed(0) : price.toFixed(1);
  return `${formatted}¢`;
}

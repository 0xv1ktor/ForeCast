import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { prepareEncryptedStake } from '../integrations/arcium.js';
import { formatCast, truncateAddress } from '../lib/formatters.js';
import { wait } from '../lib/async.js';
import { getDisplayOutcomePrices, quoteBinaryTrade } from '../lib/marketMaker.js';
import {
  ArciumBadge,
  CategoryPill,
  ExpertSignalBar,
  LockIcon,
  OddsBar,
  ProbabilityDisplay,
  SectionHeader,
  Sparkline,
  SourceBadge,
} from '../components/Primitives.jsx';

export function MarketDetailPage({
  id,
  markets,
  balance = 0,
  connected = false,
  wallet = '',
  onConnect,
  onStake,
  onResolveMarket,
  onConvertPolymarket,
  onLoadUserStakeCommitments,
  onLoadMarketStakeCommitments,
  onQueueArciumSettlement,
  onSettleAndPayStake,
}) {
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
  const [resolutionPhase, setResolutionPhase] = useState('');
  const [resolutionMessage, setResolutionMessage] = useState('');
  const [settlementRows, setSettlementRows] = useState([]);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementChecked, setSettlementChecked] = useState(false);
  const [settlementMessage, setSettlementMessage] = useState('');
  const [creatorSettlementRows, setCreatorSettlementRows] = useState([]);
  const [creatorSettlementLoading, setCreatorSettlementLoading] = useState(false);
  const [creatorSettlementMessage, setCreatorSettlementMessage] = useState('');
  const [payingCommitment, setPayingCommitment] = useState('');
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionDraft, setConversionDraft] = useState(() => makeConversionDraft(null));
  const [conversionPhase, setConversionPhase] = useState('');
  const [conversionMessage, setConversionMessage] = useState('');

  useEffect(() => {
    setSettlementRows([]);
    setSettlementChecked(false);
    setSettlementMessage('');
    setCreatorSettlementRows([]);
    setCreatorSettlementMessage('');
    setPayingCommitment('');
    setConversionOpen(false);
    setConversionDraft(makeConversionDraft(market));
    setConversionPhase('');
    setConversionMessage('');
  }, [market?.id, wallet]);

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
  const isNativeMarket = market.type === 'native';
  const isResolved = market.status === 'Resolved' || market.status === 'Cancelled';
  const isCreator = Boolean(wallet && market.createdBy && wallet === market.createdBy);
  const canResolveByDate = !market.resolutionTs || Date.now() >= Number(market.resolutionTs) * 1000;

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

    if (!isNativeMarket) {
      setStakeNoticeType('warning');
      setSuccess('Convert this Polymarket signal into a ForeCast-native market before trading with $CAST.');
      setConversionOpen(true);
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
        setSuccess(arciumResult.message);
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
      if (stakeResult.settlementRegistration?.status === 'failed') {
        setStakeNoticeType('warning');
        setSuccess(`Stake recorded, but settlement registration needs the Forecast server: ${stakeResult.settlementRegistration.error}`);
      } else {
        setSuccess(`Position encrypted and recorded on Solana. Tx ${truncateAddress(stakeResult.signature)}.`);
      }
      setActivity((items) => [{ time: 'now', side: position }, ...items.slice(0, 5)]);
    } catch (error) {
      setPhase('');
      setStakeNoticeType('warning');
      setSuccess(error.message || 'Encrypted stake submission failed.');
    }
  }

  async function resolveMarket(outcome) {
    if (!onResolveMarket || resolutionPhase) return;
    setResolutionMessage('');

    if (!connected) {
      setResolutionMessage('Connect the market creator wallet before resolving.');
      onConnect?.();
      return;
    }

    if (!isCreator) {
      setResolutionMessage('Only the wallet that created this market can resolve it.');
      return;
    }

    if (!canResolveByDate) {
      setResolutionMessage(`This market can be resolved after ${market.ends}.`);
      return;
    }

    try {
      setResolutionPhase(`Resolving ${outcome}...`);
      const result = await onResolveMarket(market, outcome);
      setResolutionPhase('');
      setResolutionMessage(`Resolved as ${result.outcome}. Tx ${truncateAddress(result.signature)}.`);
    } catch (error) {
      setResolutionPhase('');
      setResolutionMessage(error.message || 'Market resolution failed.');
    }
  }

  async function convertPolymarket(event) {
    event.preventDefault();
    if (!onConvertPolymarket || conversionPhase) return;

    if (!connected) {
      setConversionMessage('Connect Phantom or Backpack before converting this market.');
      onConnect?.();
      return;
    }

    try {
      setConversionPhase('Creating ForeCast-native market...');
      setConversionMessage('');
      await onConvertPolymarket(market, conversionDraft);
      setConversionPhase('');
      setConversionMessage('Converted to a native Forecast market.');
    } catch (error) {
      setConversionPhase('');
      setConversionMessage(error.message || 'Market conversion failed.');
    }
  }

  async function loadSettlementStatus() {
    if (!onLoadUserStakeCommitments || settlementLoading) return;

    if (!connected) {
      setSettlementMessage('Connect Phantom or Backpack before checking settlement.');
      onConnect?.();
      return;
    }

    try {
      setSettlementLoading(true);
      setSettlementMessage('');
      const rows = await onLoadUserStakeCommitments(market);
      setSettlementRows(rows);
      setSettlementChecked(true);
      if (!rows.length) {
        setSettlementMessage('No encrypted stake commitment was found for this wallet on this market.');
      }
    } catch (error) {
      setSettlementMessage(error.message || 'Settlement check failed.');
    } finally {
      setSettlementLoading(false);
    }
  }

  async function loadCreatorSettlementRows() {
    if (!onLoadMarketStakeCommitments || creatorSettlementLoading) return;

    try {
      setCreatorSettlementLoading(true);
      setCreatorSettlementMessage('');
      const rows = await onLoadMarketStakeCommitments(market);
      setCreatorSettlementRows(rows);
      if (!rows.length) {
        setCreatorSettlementMessage('No encrypted stake commitments exist for this market yet.');
      }
    } catch (error) {
      setCreatorSettlementMessage(error.message || 'Could not load settlement commitments.');
    } finally {
      setCreatorSettlementLoading(false);
    }
  }

  async function queueCreatorSettlement(row) {
    if (!onQueueArciumSettlement || payingCommitment) return;

    try {
      setPayingCommitment(row.address);
      setCreatorSettlementMessage('');
      const result = await onQueueArciumSettlement({
        market,
        stakeCommitment: row,
      });
      setCreatorSettlementRows((items) => items.map((item) => (
        item.address === row.address
          ? {
              ...item,
              settlementPayload: result,
              settlementSignature: result.signature,
              settlementClaimAmount: result.claimAmount,
              settlementStatusLabel: result.statusLabel,
            }
          : item
      )));
      setCreatorSettlementMessage(`Payout computation queued. Tx ${truncateAddress(result.signature)}.`);
    } catch (error) {
      setCreatorSettlementMessage(error.message || 'Payout computation failed.');
    } finally {
      setPayingCommitment('');
    }
  }

  async function settleCreatorPayout(row) {
    if (!onSettleAndPayStake || payingCommitment) return;

    try {
      setPayingCommitment(row.address);
      setCreatorSettlementMessage('');
      const result = await onSettleAndPayStake({
        market,
        stakeCommitment: row,
        settlementPayload: row.settlementPayload,
      });
      setCreatorSettlementRows((items) => items.map((item) => (
        item.address === row.address
          ? {
              ...item,
              status: result.status,
              statusLabel: result.statusLabel,
              payoutSignature: result.signature,
              settlementClaimAmount: row.settlementClaimAmount,
            }
          : item
      )));
      setCreatorSettlementMessage(`Payout recorded. Tx ${truncateAddress(result.signature)}.`);
    } catch (error) {
      setCreatorSettlementMessage(error.message || 'Payout settlement failed.');
    } finally {
      setPayingCommitment('');
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
                <h2><LockIcon /> Expert Oracle Signal</h2>
                <span>{market.expert.text}</span>
              </div>
              <ExpertSignalBar signal={market.expert} />
              <div className="credential-row">
                {market.expert.credentials.map((credential) => <span key={credential}>{credential}</span>)}
              </div>
              <p className="teal-note"><LockIcon /> Individual opinions encrypted by Arcium. Aggregate only.</p>
            </section>
          )}

          {!isNativeMarket && (
            <section className="criteria-panel convert-panel">
              <SectionHeader
                title="Convert To ForeCast Native"
                text="Polymarket data is read-only signal. Convert it to create a ForeCast-native $CAST market with encrypted staking."
                action={(
                  <button className="btn btn-secondary" type="button" onClick={() => setConversionOpen((open) => !open)}>
                    {conversionOpen ? 'Hide' : 'Convert'}
                  </button>
                )}
              />
              {conversionOpen && (
                <form className="conversion-form" onSubmit={convertPolymarket}>
                  <div className="two-column">
                    <label>
                      <span>Resolution Date</span>
                      <input
                        className="input"
                        type="date"
                        required
                        min={new Date().toISOString().slice(0, 10)}
                        value={conversionDraft.resolutionDate}
                        onChange={(event) => setConversionDraft((draft) => ({ ...draft, resolutionDate: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>Resolution Time</span>
                      <input
                        className="input"
                        type="time"
                        required
                        value={conversionDraft.resolutionTime}
                        onChange={(event) => setConversionDraft((draft) => ({ ...draft, resolutionTime: event.target.value }))}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Resolution Criteria</span>
                    <textarea
                      className="input"
                      rows="4"
                      required
                      value={conversionDraft.resolutionCriteria}
                      onChange={(event) => setConversionDraft((draft) => ({ ...draft, resolutionCriteria: event.target.value }))}
                    />
                  </label>
                  <div className="seed-panel compact-seed">
                    <div>
                      <span className="field-label">Optional Seed Stake</span>
                      <p>Add first-side liquidity during conversion.</p>
                    </div>
                    <div className="seed-controls">
                      <input
                        className="input"
                        placeholder="Amount"
                        inputMode="numeric"
                        value={conversionDraft.seedAmount}
                        onChange={(event) => setConversionDraft((draft) => ({ ...draft, seedAmount: event.target.value.replace(/[^0-9]/g, '') }))}
                      />
                      <div className="mini-toggle">
                        {['YES', 'NO'].map((side) => (
                          <button
                            type="button"
                            key={side}
                            className={conversionDraft.seedSide === side ? 'selected' : ''}
                            onClick={() => setConversionDraft((draft) => ({ ...draft, seedSide: side }))}
                          >
                            {side}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-full" type="submit" disabled={Boolean(conversionPhase)}>
                    {conversionPhase || 'Create Native Market'}
                  </button>
                  {conversionMessage && <p className="teal-note">{conversionMessage}</p>}
                </form>
              )}
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
                    <span><LockIcon /></span>
                    <span><LockIcon /></span>
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
                      <LockIcon /> Anonymous bought [ENCRYPTED] {item.side} - {item.time}
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
                MVP resolution is performed by the market creator against the stated criteria and source.
                Individual stake data remains private while the final public outcome is posted to Forecast.
              </p>
            )}
          </section>

          {isNativeMarket && (
            <section className="criteria-panel resolution-panel">
              <SectionHeader title="Creator Resolution" text="Only the wallet that created this native market can post the final outcome." />
              {isResolved ? (
                <div className="empty-state compact">
                  Final outcome: {market.outcome || market.status}
                </div>
              ) : isCreator ? (
                <>
                  <div className="resolution-actions">
                    <button className="trade-button trade-yes" type="button" onClick={() => resolveMarket('YES')} disabled={Boolean(resolutionPhase) || !canResolveByDate}>Resolve YES</button>
                    <button className="trade-button trade-no" type="button" onClick={() => resolveMarket('NO')} disabled={Boolean(resolutionPhase) || !canResolveByDate}>Resolve NO</button>
                    <button className="btn btn-secondary" type="button" onClick={() => resolveMarket('CANCELLED')} disabled={Boolean(resolutionPhase) || !canResolveByDate}>Cancel</button>
                  </div>
                  {!canResolveByDate && <p className="subtle">Resolution unlocks after {market.ends}.</p>}
                  {resolutionPhase && <p className="subtle">{resolutionPhase}</p>}
                </>
              ) : (
                <div className="empty-state compact">
                  Connected wallet is not the creator of this market.
                </div>
              )}
              {resolutionMessage && <p className="teal-note">{resolutionMessage}</p>}
            </section>
          )}

          {isNativeMarket && (
            <section className="criteria-panel settlement-panel">
              <SectionHeader
                title="Settlement Status"
                text={isResolved
                  ? 'Check the encrypted stake commitments tied to your wallet for this resolved market.'
                  : 'Stake commitments are recorded now. Payout settlement starts after creator resolution.'}
              />
              {!connected ? (
                <div className="empty-state compact">
                  Connect your wallet to check whether this market has an encrypted stake commitment for you.
                </div>
              ) : (
                <>
                  <div className="settlement-actions">
                    <button className="btn btn-secondary" type="button" onClick={loadSettlementStatus} disabled={settlementLoading}>
                      {settlementLoading ? 'Checking devnet...' : 'Refresh My Status'}
                    </button>
                    <span>{isResolved ? `Outcome: ${market.outcome || market.status}` : 'Waiting for final outcome'}</span>
                  </div>

                  {settlementRows.length > 0 && (
                    <div className="settlement-list">
                      {settlementRows.map((row) => (
                        <div className="settlement-row" key={row.address}>
                          <div>
                            <span className={`settlement-status-pill status-${row.status}`}>{row.statusLabel}</span>
                            <strong>Forecast commitment {truncateAddress(row.address)}</strong>
                            <small>{settlementHint(row.status, isResolved)}</small>
                          </div>
                          <div className="stake-proof-links">
                            <a href={explorerAccount(row.address)} target="_blank" rel="noreferrer">
                              Commitment account
                            </a>
                            <a href={explorerAccount(row.arciumComputation)} target="_blank" rel="noreferrer">
                              Arcium computation
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {settlementMessage && <p className="teal-note">{settlementMessage}</p>}
                  {settlementChecked && settlementRows.length === 0 && !settlementMessage && (
                    <div className="empty-state compact">
                      No encrypted stake commitment found for this wallet on this market.
                    </div>
                  )}

                  {isCreator && isResolved && (
                    <div className="author-settlement-box">
                      <SectionHeader
                        title="Author Payout Desk"
                        text="Stake privacy already ran when users traded. This desk computes private payouts after the creator posts the final outcome."
                      />
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={loadCreatorSettlementRows}
                        disabled={creatorSettlementLoading}
                      >
                        {creatorSettlementLoading ? 'Loading commitments...' : 'Load Market Commitments'}
                      </button>

                      {creatorSettlementRows.length > 0 && (
                        <div className="author-settlement-list">
                          {creatorSettlementRows.map((row) => (
                            <div className="author-settlement-row" key={row.address}>
                              <div>
                                <span className={`settlement-status-pill status-${row.status}`}>{row.statusLabel}</span>
                                <strong>{truncateAddress(row.user)}</strong>
                                <small>{truncateAddress(row.address)}</small>
                              </div>
                              <div className="author-payout-result">
                                <span>Arcium payout</span>
                                <strong>
                                  {row.settlementPayload
                                    ? `${formatCast(row.settlementPayload.claimAmount)} $CAST`
                                    : 'pending'}
                                </strong>
                                {row.settlementStatusLabel && <small>{row.settlementStatusLabel}</small>}
                              </div>
                              <button
                                className="btn btn-secondary"
                                type="button"
                                onClick={() => (row.settlementPayload ? settleCreatorPayout(row) : queueCreatorSettlement(row))}
                                disabled={row.status === 2 || Boolean(payingCommitment)}
                              >
                                {payingCommitment === row.address
                                  ? 'Working...'
                                  : row.status === 2
                                    ? 'Paid'
                                    : row.settlementPayload
                                      ? 'Pay Result'
                                      : 'Compute Payout'}
                              </button>
                              {row.settlementSignature && (
                                <a href={`https://explorer.solana.com/tx/${row.settlementSignature}?cluster=devnet`} target="_blank" rel="noreferrer">
                                  View Arcium tx
                                </a>
                              )}
                              {row.payoutSignature && (
                                <a href={`https://explorer.solana.com/tx/${row.payoutSignature}?cluster=devnet`} target="_blank" rel="noreferrer">
                                  View payout tx
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {creatorSettlementMessage && <p className="teal-note">{creatorSettlementMessage}</p>}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <aside className="stake-card order-panel">
          {!isNativeMarket && (
            <div className="conversion-notice">
              <SourceBadge source="Polymarket" />
              <h3>Convert before trading</h3>
              <p>This market is live Polymarket signal only. Create a ForeCast-native copy to enable private $CAST staking.</p>
              <button className="btn btn-primary btn-full" type="button" onClick={() => setConversionOpen(true)}>Convert Market</button>
            </div>
          )}

          {isNativeMarket && (
            <>
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function explorerAccount(address) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function makeConversionDraft(market) {
  const sourceEnd = Number(market?.endDateTs || 0);
  const fallback = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const resolutionDate = new Date(sourceEnd > Date.now() ? sourceEnd : fallback.getTime());

  return {
    resolutionDate: resolutionDate.toISOString().slice(0, 10),
    resolutionTime: '23:59',
    seedAmount: '',
    seedSide: 'YES',
    resolutionCriteria: market
      ? `Resolve using the linked Polymarket market "${market.title}" and public evidence available at resolution time.`
      : '',
  };
}

function settlementHint(status, isResolved) {
  if (status === 0) {
    return isResolved
      ? 'Stake privacy already ran. Creator payout action is still needed below.'
      : 'Encrypted stake is recorded. Settlement waits until the market resolves.';
  }

  if (status === 1) {
    return 'Encrypted payout hash is recorded. Vault transfer is the next contract step.';
  }

  if (status === 2) {
    return 'Payout transfer and claim state have been recorded on Forecast.';
  }

  if (status === 3) {
    return 'This encrypted commitment was cancelled.';
  }

  return 'Unknown settlement state.';
}

function formatCentPrice(value) {
  const price = Number(value || 0);
  const formatted = Number.isInteger(price) ? price.toFixed(0) : price.toFixed(1);
  return `${formatted}¢`;
}

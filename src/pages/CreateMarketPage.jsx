import { motion } from 'framer-motion';
import { useState } from 'react';
import { categoryOptions, credentialOptions } from '../data/forecastData.js';
import { PageHeader } from '../components/Primitives.jsx';

export function CreateMarketPage({ connected, walletProvider, onConnect, onCreateMarket }) {
  const [oracle, setOracle] = useState(true);
  const [selectedCredentials, setSelectedCredentials] = useState(['Finance', 'Crypto']);
  const [marketType, setMarketType] = useState('Public Market');
  const [seedSide, setSeedSide] = useState('YES');
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('Crypto');
  const [resolutionDate, setResolutionDate] = useState('');
  const [resolutionCriteria, setResolutionCriteria] = useState('');
  const [seedAmount, setSeedAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState(null);
  const minDate = new Date().toISOString().slice(0, 10);

  function toggleCredential(credential) {
    setSelectedCredentials((items) => (
      items.includes(credential) ? items.filter((item) => item !== credential) : [...items, credential]
    ));
  }

  async function submitMarket(event) {
    event.preventDefault();
    setNotice(null);

    if (!connected || !walletProvider) {
      setNotice({ type: 'warning', text: 'Create Market needs a real Phantom or Backpack wallet.' });
      onConnect?.();
      return;
    }

    try {
      setSubmitting(true);
      setStatus('Preparing market account...');
      await onCreateMarket({
        question,
        category,
        resolutionDate,
        resolutionCriteria,
        marketType,
        oracleEnabled: oracle,
        credentials: selectedCredentials,
        seedAmount,
        seedSide,
      });
      setStatus('Market confirmed on Solana devnet.');
    } catch (error) {
      setNotice({ type: 'warning', text: error.message || 'Market creation failed.' });
      setStatus('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page narrow-page">
      <PageHeader title="Create Market" subtitle="Launch a Forecast-native market with encrypted stakes from the first position." />

      <form className="create-form" onSubmit={submitMarket}>
        <label>
          <span>Market Question</span>
          <input
            className="input large-input"
            maxLength="180"
            placeholder="e.g. Will Bitcoin reach $100k by end of 2025?"
            required
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>

        <div className="two-column">
          <label>
            <span>Category</span>
            <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categoryOptions.filter((item) => item !== 'All').concat('Other').map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Resolution Date</span>
            <input
              className="input"
              type="date"
              min={minDate}
              required
              value={resolutionDate}
              onChange={(event) => setResolutionDate(event.target.value)}
            />
          </label>
        </div>

        <div>
          <span className="field-label">Market Type</span>
          <div className="radio-grid">
            {['Public Market', 'DAO Room Market'].map((type) => (
              <button type="button" key={type} className={marketType === type ? 'selected' : ''} onClick={() => setMarketType(type)}>
                <strong>{type}</strong>
                <small>{type === 'Public Market' ? 'Visible to all users' : 'Only visible inside a specific room'}</small>
              </button>
            ))}
          </div>
        </div>

        <label>
          <span>Resolution Criteria</span>
          <textarea
            className="input"
            rows="5"
            placeholder="Describe exactly how this market will be resolved and what source will be used to verify the outcome..."
            required
            value={resolutionCriteria}
            onChange={(event) => setResolutionCriteria(event.target.value)}
          />
          <small className="field-hint">
            MVP markets are resolved by the Forecast authority against this criteria. Creator-only resolution should wait for a dispute window or oracle flow.
          </small>
        </label>

        <div className="toggle-row">
          <div>
            <strong>Enable Expert Oracle</strong>
            <p>Credentialed experts can submit encrypted opinions.</p>
          </div>
          <button type="button" className={`switch ${oracle ? 'on' : ''}`} onClick={() => setOracle(!oracle)} aria-label="Toggle expert oracle">
            <span />
          </button>
        </div>

        {oracle && (
          <div>
            <span className="field-label">Expert Credential Types</span>
            <div className="credential-row selectable">
              {credentialOptions.map((credential) => (
                <button
                  type="button"
                  key={credential}
                  className={selectedCredentials.includes(credential) ? 'selected' : ''}
                  onClick={() => toggleCredential(credential)}
                >
                  {credential}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="seed-panel">
          <div>
            <span className="field-label">Seed Stake</span>
            <p>Add an initial stake to bootstrap liquidity.</p>
          </div>
          <div className="seed-controls">
            <input
              className="input"
              placeholder="Amount"
              inputMode="numeric"
              value={seedAmount}
              onChange={(event) => setSeedAmount(event.target.value.replace(/[^0-9]/g, ''))}
            />
            <div className="mini-toggle">
              <button type="button" className={seedSide === 'YES' ? 'selected' : ''} onClick={() => setSeedSide('YES')}>YES</button>
              <button type="button" className={seedSide === 'NO' ? 'selected' : ''} onClick={() => setSeedSide('NO')}>NO</button>
            </div>
          </div>
        </div>

        <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
          {submitting ? (
            <>
              {status || 'Waiting for wallet signature...'}
              <span className="mini-dots"><i /><i /><i /></span>
            </>
          ) : 'Create Market'}
        </button>
        <p className="teal-note center">🔒 All stakes on this market will be encrypted by Arcium MPC</p>
        {notice && (
          <motion.div
            className={`success-box ${notice.type === 'warning' ? 'warning-box' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {notice.text}
          </motion.div>
        )}
      </form>
    </div>
  );
}

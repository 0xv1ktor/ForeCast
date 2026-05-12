import { CastAmount, LockIcon, SectionHeader } from '../components/Primitives.jsx';
import { tierDetails } from '../data/forecastData.js';
import { formatCast, truncateAddress } from '../lib/formatters.js';

export function ProfilePage({ address, balance = 0, connected = false }) {
  const tiers = Object.keys(tierDetails);
  const hasAddress = connected && address && address !== 'disconnected';

  return (
    <div className="page portfolio-page">
      <section className="profile-header">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>{hasAddress ? truncateAddress(address) : 'Connect wallet'}</h1>
          <p className="mono">{hasAddress ? address : 'No wallet connected'}</p>
        </div>
        <div className="profile-badge-empty">
          <strong>UNRANKED</strong>
          <small>Reputation publishes after resolved markets</small>
        </div>
      </section>

      <div className="stats-grid">
        <ProfileStat label="$CAST Balance" value={`◎ ${formatCast(balance)}`} />
        <ProfileStat label="Open Positions" value={<CastAmount encrypted />} />
        <ProfileStat label="Payout History" value="Coming soon" />
        <ProfileStat label="Win Rate" value="Coming soon" />
      </div>

      <section className="portfolio-table">
        <SectionHeader title="Active Positions" />
        <div className="empty-state">
          Individual positions are encrypted and are not exposed through the public profile.
          Portfolio accounting will appear here after the private position indexer is connected.
        </div>
      </section>

      <section className="privacy-box">
        <strong><LockIcon /> This user's full history is encrypted by Arcium MPC.</strong>
        <p>Win rate is computed over encrypted data. No market history or position data is ever exposed.</p>
      </section>

      <section className="profile-section">
        <SectionHeader title="Reputation Breakdown" text="Accuracy tiers are public, while the record underneath remains private." />
        <div className="tier-progress">
          {tiers.map((tier) => (
            <div key={tier}>
              <span />
              <strong>{tier}</strong>
              <small>{tierDetails[tier].range}</small>
            </div>
          ))}
        </div>
        <p className="subtle">Current tier unlocks after resolved market outcomes produce reputation aggregates.</p>
      </section>

      <section className="profile-section">
        <SectionHeader title="Resolved Positions" />
        <div className="empty-state">
          No resolved Forecast positions are public. Arcium reveals reputation output only after settlement.
        </div>
      </section>
    </div>
  );
}

function ProfileStat({ label, value, encrypted, tone = '' }) {
  return (
    <article className="profile-stat">
      <span>{label}</span>
      <strong className={tone}>{encrypted ? <CastAmount encrypted /> : value}</strong>
    </article>
  );
}

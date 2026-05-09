import { AccuracyBadge, CastAmount, PageHeader, SectionHeader } from '../components/Primitives.jsx';
import { fakeWallet, tierDetails } from '../data/forecastData.js';
import { truncateAddress } from '../lib/formatters.js';

export function ProfilePage({ address }) {
  const tiers = Object.keys(tierDetails);

  return (
    <div className="page portfolio-page">
      <section className="profile-header">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>{truncateAddress(address || fakeWallet)}</h1>
          <p className="mono">{address || fakeWallet}</p>
        </div>
        <AccuracyBadge tier="Gold" large />
      </section>

      <div className="stats-grid">
        <ProfileStat label="Total Value" value="◎ 1,247" />
        <ProfileStat label="Unrealized P&L" value="+18.40%" tone="positive" />
        <ProfileStat label="Resolved P&L" value="+302" tone="positive" />
        <ProfileStat label="Win Rate" value="74.20%" />
      </div>

      <section className="portfolio-table">
        <SectionHeader title="Active Positions" />
        <div className="position-row position-head">
          <span>Market</span>
          <span>Side</span>
          <span>Shares</span>
          <span>Avg</span>
          <span>Current</span>
          <span>P&L</span>
          <span>Action</span>
        </div>
        {[
          ['BTC 150K by 2025', 'YES', '🔒', '0.62', '0.67', '+8.10%'],
          ['Fed cut June', 'YES', '🔒', '0.51', '0.58', '+13.70%'],
          ['Solana flip ETH', 'NO', '🔒', '0.61', '0.66', '+8.20%'],
        ].map(([market, side, shares, avg, current, pnl]) => (
          <div className="position-row" key={market}>
            <span>{market}</span>
            <strong className={side === 'YES' ? 'yes' : 'no'}>{side}</strong>
            <span>{shares}</span>
            <span>{avg}</span>
            <span>{current}</span>
            <span className="positive">{pnl}</span>
            <button className="btn btn-secondary">View</button>
          </div>
        ))}
      </section>

      <section className="privacy-box">
        <strong>🔒 This user's full history is encrypted by Arcium MPC.</strong>
        <p>Win rate is computed over encrypted data. No market history or position data is ever exposed.</p>
      </section>

      <section className="profile-section">
        <SectionHeader title="Reputation Breakdown" text="Accuracy tiers are public, while the record underneath remains private." />
        <div className="tier-progress">
          {tiers.map((tier) => (
            <div key={tier} className={tier === 'Gold' ? 'current' : ''}>
              <span />
              <strong>{tier}</strong>
              <small>{tierDetails[tier].range}</small>
            </div>
          ))}
        </div>
        <p className="subtle">Approaching Platinum at 80% accuracy.</p>
      </section>

      <section className="profile-section">
        <SectionHeader title="Resolved Positions" />
        <div className="activity-list">
          <div>RESOLVED / YES / +142 $CAST / 🔒 market history private</div>
          <div>RESOLVED / NO / +88 $CAST / 🔒 market history private</div>
          <div>REPUTATION / score updated / 1 week ago</div>
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

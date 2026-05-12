import { AccuracyBadge, ArciumBadge, PageHeader } from '../components/Primitives.jsx';
import { tierDetails } from '../data/forecastData.js';

export function LeaderboardPage() {
  return (
    <div className="page leaderboard-page">
      <PageHeader
        title="Global Leaderboard"
        subtitle="Private reputation ranking is coming soon."
      />

      <section className="coming-soon-panel">
        <div className="coming-soon-copy">
          <p className="eyebrow">Reputation Layer</p>
          <h2>Coming soon</h2>
          <p>
            ForeCast will rank wallets after enough markets resolve and Arcium
            can publish reputation aggregates without exposing positions,
            participation counts, or trade history.
          </p>
          <ArciumBadge short />
        </div>

        <div className="coming-soon-metrics" aria-label="Leaderboard launch criteria">
          <div>
            <span>01</span>
            <strong>Resolved markets</strong>
            <small>Outcome data feeds the private scoring pass.</small>
          </div>
          <div>
            <span>02</span>
            <strong>MPC reputation</strong>
            <small>Accuracy is computed over encrypted histories.</small>
          </div>
          <div>
            <span>03</span>
            <strong>Public tier only</strong>
            <small>Rank, badge, and win-rate aggregate become visible.</small>
          </div>
        </div>
      </section>

      <section className="tier-legend coming-soon-tiers">
        {Object.entries(tierDetails).map(([tier, detail]) => (
          <div key={tier}>
            <AccuracyBadge tier={tier} />
            <span>{detail.range}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

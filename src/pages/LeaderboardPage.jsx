import { AccuracyBadge, PageHeader } from '../components/Primitives.jsx';
import { leaderboardRows, tierDetails } from '../data/forecastData.js';

export function LeaderboardPage() {
  const topThree = leaderboardRows.slice(0, 3);

  return (
    <div className="page leaderboard-page">
      <PageHeader title="Global Leaderboard" subtitle="Ranked by accuracy. Positions always private." />

      <div className="tabs leaderboard-tabs">
        {['All Time', 'This Month', 'This Week'].map((tab, index) => (
          <button className={index === 0 ? 'active' : ''} key={tab}>{tab}</button>
        ))}
      </div>

      <section className="podium-grid">
        {topThree.map(([tier, address, winRate], index) => (
          <article className={`podium-card podium-${index + 1}`} key={address}>
            <span className="rank">#{index + 1}</span>
            <AccuracyBadge tier={tier} />
            <strong>{address}</strong>
            <em>{winRate}</em>
          </article>
        ))}
      </section>

      <section className="leaderboard-table">
        <div className="table-row table-head">
          <span>Rank</span>
          <span>Username</span>
          <span>Volume</span>
          <span>Win Rate</span>
          <span>Tier</span>
          <span>Total Return</span>
        </div>
        {leaderboardRows.map(([tier, address, winRate], index) => (
          <div className="table-row" key={`${address}-${index}`}>
            <span className="rank">{index + 1}</span>
            <span className="mono">{address}</span>
            <span>◎ {(92_000 - index * 2_730).toLocaleString()}</span>
            <strong>{winRate}</strong>
            <span>{tier}</span>
            <span className="positive">+{(124.8 - index * 4.7).toFixed(1)}%</span>
          </div>
        ))}
      </section>

      <section className="tier-legend">
        {Object.entries(tierDetails).map(([tier, detail]) => (
          <div key={tier}>
            <AccuracyBadge tier={tier} />
            <span>{detail.range}</span>
          </div>
        ))}
      </section>

      <p className="teal-note center">Arcium MPC ensures no participation data is ever exposed.</p>
    </div>
  );
}

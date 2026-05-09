import { AccuracyBadge, ArciumBadge, MarketCard, SectionHeader } from '../components/Primitives.jsx';
import { rooms } from '../data/forecastData.js';
import { formatCast } from '../lib/formatters.js';

export function RoomDetailPage({ id, navigate, markets }) {
  const room = rooms.find((item) => item.id === id) || rooms[0];
  const roomMarkets = [markets[0], markets[2], markets[10]].filter(Boolean);

  return (
    <div className="page">
      <section className="room-detail-header">
        <div>
          <p className="eyebrow">{room.category}</p>
          <h1>{room.name}</h1>
          <p>{formatCast(room.members)} members</p>
        </div>
        <div className="room-status-stack">
          <ArciumBadge permissioned />
          <span className="member-indicator">You are a member</span>
        </div>
      </section>

      <div className="room-detail-grid">
        <main>
          <SectionHeader title="Room Markets" action={<button className="btn btn-primary" onClick={() => navigate('/create')}>+ Create Room Market</button>} />
          <div className="market-grid compact">
            {roomMarkets.map((market) => <MarketCard key={market.id} market={market} navigate={navigate} />)}
          </div>
          <section className="member-privacy">
            <h2>Member List</h2>
            <p>{formatCast(room.members)} members are private to protect participation.</p>
          </section>
        </main>
        <aside className="leaderboard-side">
          <h2>Room Leaderboard</h2>
          <div className="side-table">
            {[
              ['1', 'Oracle', '0x9f3a...2d1e', '91.4%'],
              ['2', 'Platinum', '0x7c2b...8f4a', '87.2%'],
              ['3', 'Gold', '0x3e1d...5c9b', '76.8%'],
            ].map(([rank, tier, wallet, winRate]) => (
              <div key={rank}>
                <span>{rank}</span>
                <AccuracyBadge tier={tier} />
                <strong className="mono">{wallet}</strong>
                <em>{winRate}</em>
                <small>🔒</small>
              </div>
            ))}
          </div>
          <p className="teal-note">🔒 Position counts encrypted by Arcium. Win rates only.</p>
        </aside>
      </div>
    </div>
  );
}

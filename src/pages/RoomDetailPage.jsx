import { ArciumBadge, LockIcon, MarketCard, SectionHeader } from '../components/Primitives.jsx';
import { rooms } from '../data/forecastData.js';
import { formatCast } from '../lib/formatters.js';
import { readCachedRooms } from './RoomsPage.jsx';

export function RoomDetailPage({ id, navigate, markets }) {
  const room = [...readCachedRooms(), ...rooms].find((item) => item.id === id);
  const roomMarkets = markets.filter((market) => market.type === 'native').slice(0, 3);

  if (!room) {
    return (
      <div className="page">
        <section className="empty-state">
          This room is not persisted yet. Create a room from the DAO Rooms page, then wire room storage in the next integration pass.
        </section>
      </div>
    );
  }

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
          <span className="member-indicator">Preview only</span>
        </div>
      </section>

      <div className="room-detail-grid">
        <main>
          <SectionHeader title="Room Markets" text="Room-specific onchain markets are coming soon." action={<button className="btn btn-primary" onClick={() => navigate('/create')}>Create Public Market</button>} />
          {roomMarkets.length ? (
            <div className="market-grid compact">
              {roomMarkets.map((market) => <MarketCard key={market.id} market={market} navigate={navigate} />)}
            </div>
          ) : (
            <div className="empty-state compact">
              No active native markets are attached to this room preview yet.
            </div>
          )}
          <section className="member-privacy">
            <h2>Member List</h2>
            <p>{formatCast(room.members)} preview members. Wallet-gated membership is not live yet.</p>
          </section>
        </main>
        <aside className="leaderboard-side">
          <h2>Room Leaderboard</h2>
          <div className="empty-state compact">
            Room ranking opens after permissioned room markets and Arcium reputation aggregates are live.
          </div>
          <p className="teal-note"><LockIcon /> Planned: encrypted room positions with public aggregate reputation only.</p>
        </aside>
      </div>
    </div>
  );
}

import { ArciumBadge, MarketCard, SectionHeader } from '../components/Primitives.jsx';
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
          <span className="member-indicator">Permissioned room shell</span>
        </div>
      </section>

      <div className="room-detail-grid">
        <main>
          <SectionHeader title="Room Markets" action={<button className="btn btn-primary" onClick={() => navigate('/create')}>+ Create Room Market</button>} />
          {roomMarkets.length ? (
            <div className="market-grid compact">
              {roomMarkets.map((market) => <MarketCard key={market.id} market={market} navigate={navigate} />)}
            </div>
          ) : (
            <div className="empty-state compact">
              No native markets are attached to this room yet.
            </div>
          )}
          <section className="member-privacy">
            <h2>Member List</h2>
            <p>{formatCast(room.members)} members are private to protect participation.</p>
          </section>
        </main>
        <aside className="leaderboard-side">
          <h2>Room Leaderboard</h2>
          <div className="empty-state compact">
            Room ranking opens after resolved room markets produce Arcium reputation aggregates.
          </div>
          <p className="teal-note">🔒 Position counts encrypted by Arcium. Win rates only.</p>
        </aside>
      </div>
    </div>
  );
}

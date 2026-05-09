import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { PageHeader } from '../components/Primitives.jsx';
import { rooms } from '../data/forecastData.js';
import { formatCast } from '../lib/formatters.js';

export function RoomsPage({ navigate }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [customRooms, setCustomRooms] = useState([]);
  const visibleRooms = [...customRooms, ...rooms];

  function joinRoom(id) {
    setJoinedRooms((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  return (
    <div className="page">
      <PageHeader title="DAO Rooms" subtitle="Private prediction markets for communities" action={<button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ Create Room</button>} />

      <div className="rooms-grid">
        {visibleRooms.map((room) => (
          <article className="room-card" key={room.id}>
            <div className="room-head">
              <span className="room-avatar" style={{ backgroundColor: room.color || '#00c9a7' }}>{room.name[0]}</span>
              <div>
                <h3>{room.name}</h3>
                <p>{room.category}</p>
              </div>
            </div>
            <p>{room.description}</p>
            <div className="room-stats">
              <span>{formatCast(room.members)} members</span>
              <span>{room.activeMarkets} active markets</span>
              <span className="private-pill">🔒 Private</span>
            </div>
            <div className="room-actions">
              <button className="btn btn-secondary" onClick={() => navigate(`/rooms/${room.id}`)}>View</button>
              <button className="btn btn-teal" onClick={() => joinRoom(room.id)}>{joinedRooms.includes(room.id) ? 'Joined' : 'Join Room'}</button>
            </div>
          </article>
        ))}
      </div>

      <AnimatePresence>
        {modalOpen && <CreateRoomModal onClose={() => setModalOpen(false)} onCreate={(room) => { setCustomRooms((items) => [room, ...items]); setModalOpen(false); }} />}
      </AnimatePresence>
    </div>
  );
}

function CreateRoomModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('DeFi');
  const [invites, setInvites] = useState('');

  function submit(event) {
    event.preventDefault();
    onCreate({
      id: `room-${Date.now()}`,
      name,
      description,
      category,
      members: Math.max(1, invites.split('\n').filter(Boolean).length),
      activeMarkets: 0,
      color: '#00c9a7',
    });
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.form className="modal create-room-modal" onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">DAO Room</p>
            <h2>Create Room</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close room modal">×</button>
        </div>
        <label><span>Room name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span>Description</span><textarea className="input" value={description} onChange={(event) => setDescription(event.target.value)} rows="3" required /></label>
        <label><span>Category</span><select className="input" value={category} onChange={(event) => setCategory(event.target.value)}><option>DeFi</option><option>Trading</option><option>Sports</option><option>Research</option><option>Governance</option></select></label>
        <div className="privacy-line">All members can see the leaderboard. Positions stay private.</div>
        <label><span>Member invite</span><textarea className="input mono" value={invites} onChange={(event) => setInvites(event.target.value)} rows="3" placeholder="Add wallet addresses, one per line" /></label>
        <button className="btn btn-primary btn-full" type="submit">Create Room - powered by Arcium permissioned cluster</button>
      </motion.form>
    </motion.div>
  );
}

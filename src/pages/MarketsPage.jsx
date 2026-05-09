import { useMemo, useState } from 'react';
import { categoryOptions, leaderboardRows } from '../data/forecastData.js';
import {
  HeroMarketCard,
  IntegrationStatus,
  LiveMovers,
  MarketCard,
  PageHeader,
  TopTraders,
} from '../components/Primitives.jsx';

export function MarketsPage({ navigate, markets, polymarketStatus, polymarketError }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('Trending');
  const [tab, setTab] = useState('all');

  const filteredMarkets = useMemo(() => {
    let next = markets.filter((market) => {
      const matchesSearch = market.title.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = category === 'All' || market.category === category;
      const matchesTab = tab === 'all' || market.type === tab;
      return matchesSearch && matchesCategory && matchesTab;
    });

    if (sort === 'Most Staked') next = [...next].sort((a, b) => b.volume - a.volume);
    if (sort === 'Newest') next = [...next].reverse();
    if (sort === 'Ends Soon') next = [...next].sort((a, b) => new Date(a.ends) - new Date(b.ends));
    return next;
  }, [markets, search, category, sort, tab]);

  return (
    <div className="page">
      <PageHeader title="Markets" subtitle="Browse all prediction markets" action={<button className="btn btn-primary" onClick={() => navigate('/create')}>Create Market</button>} />

      <IntegrationStatus
        status={polymarketStatus}
        error={polymarketError}
        readyText="Live Polymarket markets loaded from Gamma API"
        loadingText="Loading live Polymarket markets..."
        fallbackText="Using bundled Polymarket fallback data"
      />

      <section className="markets-dashboard">
        <main className="markets-main">
          {filteredMarkets[0] && <HeroMarketCard market={filteredMarkets[0]} navigate={navigate} />}

          <div className="filter-panel">
            <div className="filter-row">
              <input className="input search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search markets..." />
              <select className="input select-input" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option>Trending</option>
                <option>Newest</option>
                <option>Ends Soon</option>
                <option>Most Staked</option>
              </select>
            </div>
            <div className="category-strip">
              {categoryOptions.map((option) => (
                <button key={option} className={category === option ? 'active' : ''} onClick={() => setCategory(option)}>{option}</button>
              ))}
            </div>
            <div className="tabs">
              {[
                ['all', 'All Markets'],
                ['native', 'Native'],
                ['polymarket', 'Polymarket Events'],
              ].map(([value, label]) => (
                <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>
              ))}
            </div>
          </div>

          <div className="market-grid">
            {filteredMarkets.slice(1).map((market) => <MarketCard key={market.id} market={market} navigate={navigate} />)}
          </div>
        </main>
        <aside className="markets-sidebar">
          <TopTraders rows={leaderboardRows} />
          <LiveMovers markets={filteredMarkets} navigate={navigate} />
        </aside>
      </section>

      <div className="pagination">
        <button className="btn btn-secondary">←</button>
        <span>Page 1 of 3</span>
        <button className="btn btn-secondary">→</button>
      </div>
    </div>
  );
}

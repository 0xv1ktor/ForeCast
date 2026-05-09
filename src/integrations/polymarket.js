const GAMMA_URL = import.meta.env.VITE_POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com';

const CATEGORY_ALIASES = [
  ['Crypto', ['crypto', 'bitcoin', 'ethereum', 'solana', 'stablecoin', 'defi']],
  ['Politics', ['politics', 'election', 'trump', 'biden', 'congress', 'senate', 'president']],
  ['Sports', ['sports', 'nba', 'nfl', 'mlb', 'soccer', 'premier league', 'ufc']],
  ['Science', ['science', 'space', 'spacex', 'nasa', 'climate', 'health']],
  ['Technology', ['technology', 'ai', 'openai', 'gemini', 'apple', 'tesla']],
  ['Finance', ['finance', 'fed', 'rates', 'recession', 'etf', 'inflation', 'market']],
];

export async function fetchForecastPolymarkets({ limit = 10, signal } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: '0',
    closed: 'false',
    active: 'true',
    order: 'volumeNum',
    ascending: 'false',
  });

  const response = await fetch(`${GAMMA_URL}/markets?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Polymarket request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const records = Array.isArray(body) ? body : body?.data || [];

  return records
    .map(mapPolymarket)
    .filter(Boolean)
    .slice(0, limit);
}

function mapPolymarket(raw) {
  const title = raw.question || raw.title || raw.groupItemTitle;
  if (!title) return null;

  const outcomes = parseJsonArray(raw.outcomes);
  const outcomePrices = parseJsonArray(raw.outcomePrices);
  const yesIndex = findOutcomeIndex(outcomes, 'yes');
  const noIndex = findOutcomeIndex(outcomes, 'no');
  const yesPrice = readPrice(outcomePrices, yesIndex);
  const noPrice = readPrice(outcomePrices, noIndex);
  const yes = normalizePercent(yesPrice, noPrice);
  const no = Math.max(0, 100 - yes);
  const volume = Number(raw.volumeNum ?? raw.volume ?? raw.volumeClob ?? 0) || 0;
  const id = raw.slug || raw.id || raw.conditionId || raw.condition_id;

  return {
    id: `poly-live-${id}`,
    title,
    category: normalizeCategory(raw.category, title, raw.events),
    type: 'polymarket',
    source: 'Polymarket',
    live: true,
    yes,
    no,
    volume,
    volumeDisplay: formatUsdVolume(volume),
    ends: formatEndDate(raw.endDateIso || raw.endDate || raw.end_date_iso),
    createdBy: `0xpoly${String(raw.conditionId || raw.condition_id || id || 'market').slice(0, 12)}`,
    conditionId: raw.conditionId || raw.condition_id,
    slug: raw.slug,
    clobTokenIds: parseJsonArray(raw.clobTokenIds || raw.clob_token_ids),
    resolutionSource: raw.resolutionSource,
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findOutcomeIndex(outcomes, name) {
  const index = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === name);
  return index >= 0 ? index : name === 'yes' ? 0 : 1;
}

function readPrice(prices, index) {
  const value = Number(prices[index]);
  return Number.isFinite(value) ? value : null;
}

function normalizePercent(yesPrice, noPrice) {
  if (yesPrice !== null) {
    const percent = yesPrice <= 1 ? yesPrice * 100 : yesPrice;
    return clampPercent(Math.round(percent));
  }

  if (noPrice !== null) {
    const percent = noPrice <= 1 ? noPrice * 100 : noPrice;
    return clampPercent(100 - Math.round(percent));
  }

  return 50;
}

function clampPercent(value) {
  return Math.min(99, Math.max(1, value));
}

function normalizeCategory(category, title, events = []) {
  const eventCategory = events?.[0]?.category || events?.[0]?.subcategory || '';
  const haystack = `${category || ''} ${eventCategory} ${title || ''}`.toLowerCase();
  const match = CATEGORY_ALIASES.find(([, terms]) => terms.some((term) => haystack.includes(term)));
  return match?.[0] || 'World Events';
}

function formatUsdVolume(volume) {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(2)}M USD`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K USD`;
  return `$${Math.round(volume).toLocaleString()} USD`;
}

function formatEndDate(value) {
  if (!value) return 'Open';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Open';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

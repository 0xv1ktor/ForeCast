const DIRECT_GAMMA_URL = 'https://gamma-api.polymarket.com';
const ENV_GAMMA_URL = normalizeBaseUrl(import.meta.env.VITE_POLYMARKET_GAMMA_URL || '');
const SHOULD_USE_PROXY = !ENV_GAMMA_URL || ENV_GAMMA_URL === DIRECT_GAMMA_URL;
const GAMMA_URL = normalizeBaseUrl(SHOULD_USE_PROXY ? '/api/polymarket' : ENV_GAMMA_URL);

const CATEGORY_ALIASES = [
  ['Crypto', ['crypto', 'bitcoin', 'ethereum', 'solana', 'stablecoin', 'defi']],
  ['Politics', ['politics', 'election', 'trump', 'biden', 'congress', 'senate', 'president']],
  ['Sports', ['sports', 'nba', 'nfl', 'mlb', 'soccer', 'premier league', 'ufc']],
  ['Science', ['science', 'space', 'spacex', 'nasa', 'climate', 'health']],
  ['Technology', ['technology', 'ai', 'openai', 'gemini', 'apple', 'tesla']],
  ['Finance', ['finance', 'fed', 'rates', 'recession', 'etf', 'inflation', 'market']],
];

export async function fetchForecastPolymarkets({ limit = 10, signal } = {}) {
  const endpoints = [
    buildEventsUrl(limit),
    buildMarketsUrl(limit),
  ];
  let lastError;

  for (const endpoint of endpoints) {
    try {
      const records = await fetchPolymarketRecords(endpoint, signal);
      const markets = records
        .map((record) => mapPolymarket(record.market, record.event))
        .filter(Boolean)
        .filter(isActivePolymarket)
        .sort(comparePolymarketRecency)
        .slice(0, limit);

      if (markets.length) return markets;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }
  }

  throw lastError || new Error('No live Polymarket markets returned');
}

function buildEventsUrl(limit) {
  const params = new URLSearchParams({
    limit: String(Math.max(limit, 20)),
    offset: '0',
    active: 'true',
    closed: 'false',
    order: 'volume_24hr',
    ascending: 'false',
  });

  return `${GAMMA_URL}/events?${params.toString()}`;
}

function buildMarketsUrl(limit) {
  const params = new URLSearchParams({
    limit: String(Math.max(limit, 20)),
    offset: '0',
    active: 'true',
    closed: 'false',
    order: 'volumeNum',
    ascending: 'false',
  });

  return `${GAMMA_URL}/markets?${params.toString()}`;
}

async function fetchPolymarketRecords(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Polymarket request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const records = Array.isArray(body) ? body : body?.data || body?.events || [];

  if (url.includes('/events')) {
    return records.flatMap((event) => {
      const eventMarkets = Array.isArray(event.markets) ? event.markets : [];
      return eventMarkets.map((market) => ({ market, event }));
    });
  }

  return records.map((market) => ({ market, event: market.events?.[0] || null }));
}

function mapPolymarket(raw, event) {
  const title = raw.question || raw.title || raw.groupItemTitle || event?.title;
  if (!title) return null;

  const outcomes = parseJsonArray(raw.outcomes);
  const outcomePrices = parseJsonArray(raw.outcomePrices);
  const yesIndex = findOutcomeIndex(outcomes, 'yes');
  const noIndex = findOutcomeIndex(outcomes, 'no');
  const yesPrice = readPrice(outcomePrices, yesIndex);
  const noPrice = readPrice(outcomePrices, noIndex);
  const yes = normalizePercent(yesPrice, noPrice);
  const no = Math.max(0, 100 - yes);
  const volume = Number(raw.volumeNum ?? raw.volume ?? raw.volumeClob ?? raw.volume24hr ?? event?.volume ?? 0) || 0;
  const id = raw.slug || raw.id || raw.conditionId || raw.condition_id;
  const endDateValue = raw.endDateIso || raw.endDate || raw.end_date_iso || event?.endDate;
  const startDateValue = raw.startDate || raw.startDateIso || raw.start_date_iso || event?.startDate || event?.createdAt || raw.createdAt;

  return {
    id: `poly-live-${id}`,
    title,
    category: normalizeCategory(raw.category || event?.category, title, raw.events || [event]),
    type: 'polymarket',
    source: 'Polymarket',
    live: true,
    yes,
    no,
    volume,
    volumeDisplay: formatUsdVolume(volume),
    ends: formatEndDate(endDateValue),
    endDateTs: readDateTs(endDateValue),
    startDateTs: readDateTs(startDateValue),
    createdBy: raw.conditionId || raw.condition_id || raw.slug || id,
    conditionId: raw.conditionId || raw.condition_id,
    slug: raw.slug,
    clobTokenIds: parseJsonArray(raw.clobTokenIds || raw.clob_token_ids),
    resolutionSource: raw.resolutionSource || event?.resolutionSource,
  };
}

function isActivePolymarket(market) {
  if (!market?.endDateTs) return false;
  return market.endDateTs > Date.now();
}

function comparePolymarketRecency(a, b) {
  const aFresh = a.startDateTs || a.endDateTs || 0;
  const bFresh = b.startDateTs || b.endDateTs || 0;
  if (bFresh !== aFresh) return bFresh - aFresh;
  return Number(b.volume || 0) - Number(a.volume || 0);
}

function normalizeBaseUrl(url) {
  return String(url).replace(/\/$/, '');
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
    return clampPercent(toOneDecimal(percent));
  }

  if (noPrice !== null) {
    const percent = noPrice <= 1 ? noPrice * 100 : noPrice;
    return clampPercent(toOneDecimal(100 - percent));
  }

  return 50;
}

function clampPercent(value) {
  return Math.min(99.9, Math.max(0.1, value));
}

function toOneDecimal(value) {
  return Number(Number(value || 0).toFixed(1));
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

function readDateTs(value) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

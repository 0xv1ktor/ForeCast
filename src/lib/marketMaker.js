const MIN_PROBABILITY = 0.01;
const MAX_PROBABILITY = 0.99;
const MIN_LIQUIDITY = 20;
const VOLUME_LIQUIDITY_FACTOR = 2;

export function getDisplayOutcomePrices(yesPercent) {
  const yes = clamp(Number(yesPercent || 50), 1, 99);
  return {
    yes,
    no: 100 - yes,
  };
}

export function quoteBinaryTrade({ yesPercent = 50, volume = 0, position = 'YES', amount = 0 }) {
  const spend = Math.max(0, Number(amount || 0));
  const liquidity = getLiquidity(volume);
  const probability = clamp(Number(yesPercent || 50) / 100, MIN_PROBABILITY, MAX_PROBABILITY);
  const initialLogit = liquidity * Math.log(probability / (1 - probability));
  const expLogit = Math.exp(initialLogit / liquidity);
  const costGrowth = Math.exp(spend / liquidity);
  let nextLogit = initialLogit;
  let shares = 0;

  if (spend > 0 && position === 'YES') {
    nextLogit = liquidity * Math.log(Math.max(1e-9, costGrowth * (expLogit + 1) - 1));
    shares = nextLogit - initialLogit;
  }

  if (spend > 0 && position === 'NO') {
    const noShares = liquidity * Math.log(Math.max(1e-9, costGrowth * (expLogit + 1) - expLogit));
    nextLogit = initialLogit - noShares;
    shares = noShares;
  }

  const nextYes = sigmoid(nextLogit / liquidity) * 100;
  const boundedYes = clamp(roundOne(nextYes), 0.1, 99.9);
  const avgPrice = shares > 0
    ? clamp((spend / shares) * 100, 0.1, 99.9)
    : position === 'YES'
      ? getDisplayOutcomePrices(yesPercent).yes
      : getDisplayOutcomePrices(yesPercent).no;

  return {
    yes: boundedYes,
    no: roundOne(100 - boundedYes),
    shares: Math.max(0, shares),
    avgPrice: roundOne(avgPrice),
    payout: Math.max(0, shares),
    liquidity,
  };
}

function getLiquidity(volume) {
  return Math.max(MIN_LIQUIDITY, Number(volume || 0) * VOLUME_LIQUIDITY_FACTOR);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function roundOne(value) {
  return Number(Number(value || 0).toFixed(1));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

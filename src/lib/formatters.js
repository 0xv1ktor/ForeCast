export function truncateAddress(address) {
  if (!address) return '';
  if (address.includes('...')) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatCast(value) {
  return Number(value || 0).toLocaleString();
}

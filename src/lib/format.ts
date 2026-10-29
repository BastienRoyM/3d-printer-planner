export function formatMinutes(m: number | null | undefined): string {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  if (h === 0) return `${min}m`;
  return min === 0 ? `${h}h` : `${h}h ${min}m`;
}

export function formatGrams(g: number | null | undefined): string {
  if (g == null) return "—";
  if (g >= 1000) return `${Number((g / 1000).toFixed(2))} kg`;
  return `${Math.round(g)} g`;
}

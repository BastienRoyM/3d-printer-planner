export function formatMinutes(m: number | null | undefined): string {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  if (h === 0) return `${min}m`;
  return min === 0 ? `${h}h` : `${h}h ${min}m`;
}

/** Reads "3h 20m", "3h", "45m", "3:20", "2.5h" or plain minutes; blank is null, nonsense is NaN. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (t === "") return null;
  const clock = t.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const parts = t.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (!parts || (parts[1] == null && parts[2] == null)) return NaN;
  return Math.round(Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0));
}

export function formatGrams(g: number | null | undefined): string {
  if (g == null) return "—";
  return g >= 1000 ? `${Number((g / 1000).toFixed(2))} kg` : `${Math.round(g)} g`;
}

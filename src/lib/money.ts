export const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "CHF"];

// Set once from the settings; every price on screen uses it.
let currency = "CAD";

export function setCurrency(code: string) {
  currency = code;
}

export function formatMoney(cents: number | null | undefined, code = currency): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(cents / 100);
}

/** Reads "12", "12.5", "12,50" or "$12.50" as cents; blank is null, nonsense is NaN. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[^\d.,-]/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** Cents as a plain editable number, like "12.50". */
export function centsToInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

const MIDNIGHT_SEARCH_MS = 48 * 60 * 60 * 1000;
const MIDNIGHT_SEARCH_STEPS = 28;

type Bounds = { before: number; after: number };

function localDateIn(zone: string): (ms: number) => string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ms) => format.format(new Date(ms));
}

export function nextLocalMidnight(zone: string, now: string): string {
  const dateAt = localDateIn(zone);
  const nowMs = Date.parse(now);
  const today = dateAt(nowMs);
  const start: Bounds = { before: nowMs, after: nowMs + MIDNIGHT_SEARCH_MS };
  const { after } = Array.from({ length: MIDNIGHT_SEARCH_STEPS }).reduce<Bounds>((bounds) => {
    const middle = Math.floor((bounds.before + bounds.after) / 2);
    return dateAt(middle) === today ? { before: middle, after: bounds.after } : { before: bounds.before, after: middle };
  }, start);
  return new Date(after).toISOString();
}

// Fractional ordering keys: a new key can always be generated between two existing ones,
// so moving a stop rewrites only that stop's row (and only that row can conflict).
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS.charAt(0);

function digit(c: string | undefined): number {
  return c === undefined ? 0 : DIGITS.indexOf(c);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a.charAt(n) || ZERO) === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? digit(a[0]) : 0;
  const db = b !== null ? digit(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS.charAt(Math.round((da + db) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(da) + midpoint(a.slice(1), null);
}

/** A key strictly between `before` and `after` (null = open end). */
export function keyBetween(before: string | null, after: string | null): string {
  const a = before ?? "";
  if (after !== null && a >= after) throw new Error(`keyBetween: ${a} is not before ${after}`);
  if (a.endsWith(ZERO) || after?.endsWith(ZERO)) throw new Error("keyBetween: keys must not end with 0");
  return midpoint(a, after);
}

/** Stable order: by position, ties (concurrent inserts on two devices) broken by id. */
export function byPosition<T extends { position: string; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

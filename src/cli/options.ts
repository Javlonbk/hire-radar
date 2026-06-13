export function parseLimit(value: string | undefined, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return n;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (!DATE_RE.test(value) || Number.isNaN(new Date(value).valueOf())) {
    throw new Error(`Invalid ${flag} date (expected YYYY-MM-DD): ${value}`);
  }
  return value;
}

export function parseDateValue(value: string | undefined, flag: string): Date | undefined {
  const validated = parseDate(value, flag);
  return validated === undefined ? undefined : new Date(validated);
}

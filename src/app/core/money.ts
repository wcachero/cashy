const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
});

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatPhp(value: number | null | undefined): string {
  return phpFormatter.format(value ?? 0);
}

export function parseMoney(value: string | number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? round2(Math.max(0, value)) : 0;
  }
  const cleaned = value.replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? round2(Math.max(0, parsed)) : 0;
}

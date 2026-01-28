// lib/rotateSlice.ts
export function rotateSlice<T>(arr: T[], take: number, seed: number): T[] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  if (!Number.isFinite(take) || take <= 0) return [];

  const n = arr.length;
  const start = ((seed % n) + n) % n;

  const out: T[] = [];
  const count = Math.min(take, n);

  for (let i = 0; i < count; i++) {
    out.push(arr[(start + i) % n]);
  }
  return out;
}

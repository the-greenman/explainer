// Small shared helpers.
/** A number attribute: `d` when missing, blank or not finite. */
export const num = (s: string | null | undefined, d: number) => { const n = s == null || s.trim() === '' ? NaN : Number(s); return Number.isFinite(n) ? n : d; };
/** Round to 3 decimals (stable output for styles and attributes). */
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type Result<T = void> = { ok: true; value: T } | { ok: false; reason: string };
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
export function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

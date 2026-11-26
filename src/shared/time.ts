export function iso(nowMs: number) {
  return new Date(nowMs).toISOString();
}

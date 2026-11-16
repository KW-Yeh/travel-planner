/**
 * The leg between two stops always has the same id, derived from the pair. Two devices that
 * create the same leg offline therefore write the same row (resolved by last-writer-wins)
 * instead of two rows that would collide on the one-live-leg-per-pair index.
 */
export async function legIdFor(fromStopId: string, toStopId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`leg:${fromStopId}>${toStopId}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = 0x80 | ((bytes[6] ?? 0) & 0x0f); // version 8 (custom)
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Which signer each auto-detected field belongs to.
 *
 * Contracts lay out one signature block per party, in reading order: "For
 * Acme — Signature / Name / Title / Date", then the same for the counterparty
 * (below it, or beside it in a two-column layout). So:
 *
 *   - signature fields, in reading order, go to signer 1, 2, 3, …;
 *   - initials sharing one line ("Initials: ___  Initials: ___") go left to
 *     right to signer 1, 2, …;
 *   - every other field joins the signature block it sits under on the same
 *     page (same column first), else the next block below it, else the last
 *     block before its page.
 *
 * Pure and dependency-free: the builder runs it in the browser, tests in Bun.
 * Coordinates are top-left percentages (DetectedField convention).
 */

export interface PlaceableField {
  fieldType: string;
  pageNumber: number;
  x: number;
  y: number;
}

const SAME_LINE = 1.5; // % of page height
const SAME_COLUMN = 25; // % of page width

function readingOrder(a: PlaceableField, b: PlaceableField): number {
  if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
  if (Math.abs(a.y - b.y) > SAME_LINE) return a.y - b.y;
  return a.x - b.x;
}

/** Signer index (0-based) for each field, in the input order. */
export function assignFieldsToSigners(fields: PlaceableField[], signerCount: number): number[] {
  const result = fields.map(() => 0);
  if (signerCount <= 1 || fields.length === 0) return result;

  const order = fields.map((_, i) => i).sort((a, b) => readingOrder(fields[a], fields[b]));
  const signatures = order.filter((i) => fields[i].fieldType === "signature");
  const blockOf = new Map<number, number>();
  signatures.forEach((fieldIndex, block) => {
    blockOf.set(fieldIndex, block);
    result[fieldIndex] = block % signerCount;
  });

  // Initials that share a line are one per party, left to right.
  const sharedInitials = new Set<number>();
  const initials = order.filter((i) => fields[i].fieldType === "initials");
  for (const i of initials) {
    const line = initials.filter((j) =>
      fields[j].pageNumber === fields[i].pageNumber && Math.abs(fields[j].y - fields[i].y) <= SAME_LINE);
    if (line.length < 2) continue;
    line.sort((a, b) => fields[a].x - fields[b].x).forEach((j, position) => {
      result[j] = position % signerCount;
      sharedInitials.add(j);
    });
  }

  if (signatures.length === 0) return result;

  for (const i of order) {
    if (blockOf.has(i) || sharedInitials.has(i)) continue;
    const field = fields[i];
    const onPage = signatures.filter((s) => fields[s].pageNumber === field.pageNumber);
    const inColumn = onPage.filter((s) => Math.abs(fields[s].x - field.x) <= SAME_COLUMN);
    const pick = (candidates: number[]) => {
      const above = candidates.filter((s) => fields[s].y <= field.y + SAME_LINE);
      if (above.length) return above.reduce((best, s) => (fields[s].y > fields[best].y ? s : best));
      const below = candidates.filter((s) => fields[s].y > field.y);
      if (below.length) return below.reduce((best, s) => (fields[s].y < fields[best].y ? s : best));
      return undefined;
    };
    const anchor = pick(inColumn) ?? pick(onPage) ??
      // No block on this page: the last block before it, else the first after it.
      [...signatures].reverse().find((s) => fields[s].pageNumber < field.pageNumber) ??
      signatures[0];
    result[i] = blockOf.get(anchor)! % signerCount;
  }
  return result;
}

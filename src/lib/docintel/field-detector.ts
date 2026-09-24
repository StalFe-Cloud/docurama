/**
 * Field detector for document intelligence.
 *
 * Discovers signature blocks, initials, date stamps and form inputs through
 * AcroForm inspection, embedded text-layer keyword matching (French + English),
 * and fallback heuristics for legacy or scanned contracts.
 */

import type { DetectedField, ExtractResult, FieldType, PageGeometry, TextItemBox } from "./types";

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

interface KeywordRule {
  type: FieldType;
  /** Label vocabulary (French + English). Matched with the `giu` flags. */
  label: string;
  confidence: number;
  /** Size of a field placed BELOW a standalone label, in points. */
  width: number;
  height: number;
  /** Height of a field drawn ON a fill-in blank next to its label. */
  lineHeight: number;
}

// Labels, not keywords: a rule only fires where the text is shaped like a form
// label (see isFormLabel) — "Date: ____", "Signature", "Nom :" — never on the
// same words inside a sentence ("…from the Effective Date.", "the signature of
// this agreement"). Word boundaries are explicit lookarounds because \b after a
// colon only matches when a letter follows, which silently disabled "Title:".
const RULES: KeywordRule[] = [
  {
    type: "signature",
    label: "bon\\s+pour\\s+accord|lu\\s+et\\s+approuv[ée]e?|cachet\\s+et\\s+signature|sign[ée]e?\\s+par|authori[sz]ed\\s+signature|signed\\s+by|signature",
    confidence: 0.88, width: 160, height: 50, lineHeight: 34,
  },
  {
    type: "date",
    label: "date\\s+de\\s+signature|fait\\s+[àa]\\s+[^,:_]{0,40},?\\s*le|dated|date",
    confidence: 0.84, width: 110, height: 28, lineHeight: 22,
  },
  {
    type: "initials",
    label: "paraphes?|initiales?|initial\\s+here|initials?",
    confidence: 0.85, width: 70, height: 35, lineHeight: 26,
  },
  {
    type: "text",
    label: "full\\s+name|printed\\s+name|name|pr[ée]nom|nom|title|position|company|soci[ée]t[ée]|fonction|qualit[ée]",
    confidence: 0.76, width: 140, height: 26, lineHeight: 22,
  },
];

const BLANK = /^\s*[:：]?\s*(?:_{3,}|\.{4,}|…{2,})/;
const TRAILING_COLON = /^\s*[:：]\s*$/;

/**
 * Is the match at `index` a form label rather than a word in running text?
 * It must start a label (item start, or after whitespace/a blank run) and be
 * followed by a fill-in blank, a lone colon, or nothing (a standalone label).
 */
function isFormLabel(text: string, index: number, length: number): { onBlank: boolean } | null {
  // Mid-sentence words ("…from the Effective Date.") are not labels: only the
  // line start or a previous label's blank may precede a label.
  const before = text.slice(0, index);
  if (before.trim() && !/(?:_{3,}|\.{4,}|…{2,}|[:：])\s*$/.test(before)) return null;
  const after = text.slice(index + length);
  if (BLANK.test(after)) return { onBlank: true };
  if (TRAILING_COLON.test(after) || !after.trim()) return { onBlank: false };
  return null;
}

/** x position (pt) of a character index, assuming evenly spaced glyphs. */
function xAt(item: TextItemBox, index: number): number {
  const len = Math.max(1, item.text.length);
  return item.x0 + ((item.x1 - item.x0) * index) / len;
}

/**
 * Is `b` the same field as `a` found twice (an AcroForm widget and its printed
 * label, say)? Only near-identical positions count: form lines sit ~3% apart
 * (25pt), and a 5%-tall window used to swallow "Title:" and "Date:" under "Name:".
 */
function isOverlapping(a: DetectedField, b: DetectedField): boolean {
  if (a.pageNumber !== b.pageNumber) return false;
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx < 3 && dy < 1.5;
}

/**
 * Extract fields from AcroForm interactive form fields if present.
 */
async function detectAcroFormFields(pdfBytes?: Uint8Array): Promise<DetectedField[]> {
  if (!pdfBytes || pdfBytes.length === 0) return [];
  const fields: DetectedField[] = [];

  try {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise;

    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations().catch(() => []);

        for (const annot of annotations as any[]) {
          if (annot.subtype === "Widget" && annot.rect && Array.isArray(annot.rect) && annot.rect.length === 4) {
            const [x0, y0, x1, y1] = annot.rect as number[];
            const width = Math.max(20, Math.abs(x1 - x0));
            const height = Math.max(15, Math.abs(y1 - y0));

            // Convert PDF user space (origin bottom-left) to top-left percentages
            const topY = viewport.height - Math.max(y0, y1);
            const xPercent = Math.max(0, Math.min(100, (Math.min(x0, x1) / viewport.width) * 100));
            const yPercent = Math.max(0, Math.min(100, (topY / viewport.height) * 100));

            let fieldType: FieldType = "text";
            const fieldName = String(annot.fieldName || annot.alternativeText || "field").toLowerCase();

            if (annot.fieldType === "Sig" || /sign|signature/i.test(fieldName)) {
              fieldType = "signature";
            } else if (annot.fieldType === "Btn") {
              fieldType = annot.checkBox ? "checkbox" : "radio";
            } else if (annot.fieldType === "Ch") {
              fieldType = "dropdown";
            } else if (/date/i.test(fieldName)) {
              fieldType = "date";
            } else if (/init|paraph/i.test(fieldName)) {
              fieldType = "initials";
            }

            fields.push({
              fieldType,
              pageNumber: n,
              x: Math.round(xPercent * 10) / 10,
              y: Math.round(yPercent * 10) / 10,
              width: Math.round(width),
              height: Math.round(height),
              name: annot.fieldName || `${fieldType}_p${n}`,
              confidence: 0.98,
              source: "acroform",
            });
          }
        }
        page.cleanup();
      }
    } finally {
      await (doc as any).destroy?.()?.catch?.(() => undefined);
    }
  } catch (err) {
    console.warn("[field detector acroform warning]", err);
  }

  return fields;
}

/**
 * Scan text items on a page for signature, date and input keywords.
 */
function scanPageKeywords(page: PageGeometry): DetectedField[] {
  const fields: DetectedField[] = [];
  if (!page.items || page.items.length === 0) return fields;

  for (const item of page.items) {
    // Every label on the line ("Initials: ____   Initials: ____" is two
    // fields), earliest rule wins where two rules claim the same characters.
    const claimed: { start: number; end: number }[] = [];
    const matches: { rule: KeywordRule; index: number; length: number }[] = [];
    for (const rule of RULES) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${rule.label})(?![\\p{L}\\p{N}])`, "giu");
      for (const m of item.text.matchAll(re)) {
        const index = m.index ?? 0;
        if (claimed.some((c) => index < c.end && index + m[0].length > c.start)) continue;
        claimed.push({ start: index, end: index + m[0].length });
        matches.push({ rule, index, length: m[0].length });
      }
    }
    matches.sort((a, b) => a.index - b.index);

    for (const { rule, index, length } of matches) {
      const printed = item.text.slice(index, index + length).replace(/\s+/g, " ").trim();
      const shape = isFormLabel(item.text, index, length);
      if (!shape) continue;

      let xPt: number;
      let yPt: number;
      let width = rule.width;
      let height = rule.height;
      if (shape.onBlank) {
        // Sit ON the fill-in blank to the right of the label, resting on the baseline.
        const blankStart = index + length + (item.text.slice(index + length).search(/[_.…]/) || 0);
        xPt = xAt(item, blankStart);
        const nextLabel = matches.find((m) => m.index > index);
        const blankEnd = nextLabel ? xAt(item, nextLabel.index) : item.x1;
        width = Math.max(rule.type === "initials" ? 50 : 90, Math.min(rule.width, blankEnd - xPt));
        height = rule.lineHeight;
        yPt = item.y1 + 3 - height;
      } else {
        // Standalone label: the field goes on the line below it.
        xPt = item.x0;
        yPt = item.y1 + 6;
      }
      yPt = Math.max(0, Math.min(page.height - height, yPt));

      const xPercent = Math.max(2, Math.min(85, (xPt / page.width) * 100));
      const yPercent = Math.max(2, Math.min(90, (yPt / page.height) * 100));

      const field: DetectedField = {
        fieldType: rule.type,
        pageNumber: page.pageNumber,
        x: Math.round(xPercent * 10) / 10,
        y: Math.round(yPercent * 10) / 10,
        width: Math.round(width),
        height: Math.round(height),
        name: `${rule.type}_p${page.pageNumber}_${fields.length + 1}`,
        ...(rule.type === "text" ? { label: printed.charAt(0).toUpperCase() + printed.slice(1) } : {}),
        confidence: rule.confidence,
        source: "keyword",
      };

      if (!fields.some((existing) => isOverlapping(existing, field))) {
        fields.push(field);
      }
    }
  }

  return fields;
}

/**
 * Run field detection across all pages of an extracted document.
 */
export async function detectFields(
  extract: ExtractResult,
  pdfBytes?: Uint8Array,
): Promise<DetectedField[]> {
  const results: DetectedField[] = [];

  // 1. Try AcroForm interactive form extraction first
  if (pdfBytes && pdfBytes.length > 0) {
    const acroFields = await detectAcroFormFields(pdfBytes);
    results.push(...acroFields);
  }

  // 2. Keyword detection on text items
  for (const page of extract.pages) {
    const pageFields = scanPageKeywords(page);
    for (const f of pageFields) {
      if (!results.some((existing) => isOverlapping(existing, f))) {
        results.push(f);
      }
    }
  }

  // 3. Fallback signature block on the last page if no signatures were found
  const hasSignature = results.some((f) => f.fieldType === "signature");
  if (!hasSignature && extract.pageCount > 0) {
    const lastPage = extract.pageCount;
    results.push(
      {
        fieldType: "date",
        pageNumber: lastPage,
        x: 60,
        y: 76,
        width: 110,
        height: 28,
        name: `date_p${lastPage}_fallback`,
        confidence: 0.5,
        source: "fallback",
      },
      {
        fieldType: "signature",
        pageNumber: lastPage,
        x: 60,
        y: 82,
        width: 160,
        height: 50,
        name: `signature_p${lastPage}_fallback`,
        confidence: 0.5,
        source: "fallback",
      },
    );
  }

  return results;
}

/**
 * Sprint 8 content translation pipeline.
 *
 * Translates the marketing content corpus (docs, blog, knowledge base,
 * template gallery) into FR/DE/ES via the z-ai-web-dev-sdk LLM, writing
 * `frontend/src/content/i18n/<locale>.json`. Key scheme mirrors
 * `frontend/src/content/localize.ts` exactly; missing keys fall back to
 * English at render time.
 *
 * Guardrails:
 * - Inline HTML (<strong>, <code>) is preserved verbatim.
 * - Product/standard names are never translated (Docurama, PAdES, eIDAS,
 *   ESIGN, RFC 3161, X.509, Fair Exit Guarantee, PKCS#12).
 * - The vocabulary guardrail: the platform runs a compliance *program*;
 *   certification claims are forbidden. Output is scanned for certification-
 *   claim patterns in FR/DE/ES and hits are reported loudly.
 * - Idempotent: already-translated keys are skipped unless --force.
 *
 * Run: cd /home/z/my-project/docurama && bun scripts/translate_content.ts
 */
// The SDK is installed in bun's global tree; resolve by absolute path so the
// script runs from any cwd.
import ZAI from '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { DOCS } from '../frontend/src/content/docs';
import { BLOG_POSTS } from '../frontend/src/content/blog';
import { KB_ITEMS } from '../frontend/src/content/kb';
import { GALLERY_ITEMS } from '../frontend/src/content/gallery';

const FORCE = process.argv.includes('--force');
const LOCALES = ['fr', 'de', 'es'] as const;
const OUT_DIR = new URL('../frontend/src/content/i18n/', import.meta.url).pathname;
const BATCH = 14;

type Entry = { key: string; text: string };

function buildEntries(): Entry[] {
  const out: Entry[] = [];
  const pushBlock = (prefix: string, b: any, i: number) => {
    if (b.h2 !== undefined) out.push({ key: `${prefix}.b${i}.h2`, text: b.h2 });
    if (b.p !== undefined) out.push({ key: `${prefix}.b${i}.p`, text: b.p });
    (b.list ?? []).forEach((li: string, j: number) =>
      out.push({ key: `${prefix}.b${i}.list.${j}`, text: li }),
    );
    if (b.callout !== undefined) out.push({ key: `${prefix}.b${i}.callout`, text: b.callout });
  };

  for (const d of DOCS) {
    out.push({ key: `doc.${d.slug}.title`, text: d.title });
    out.push({ key: `doc.${d.slug}.description`, text: d.description });
    d.blocks.forEach((b, i) => pushBlock(`doc.${d.slug}`, b, i));
  }
  for (const p of BLOG_POSTS) {
    out.push({ key: `blog.${p.slug}.title`, text: p.title });
    out.push({ key: `blog.${p.slug}.description`, text: p.description });
    p.blocks.forEach((b, i) => pushBlock(`blog.${p.slug}`, b, i));
  }
  for (const k of KB_ITEMS) {
    out.push({ key: `kb.${k.id}.q`, text: k.q });
    out.push({ key: `kb.${k.id}.a`, text: k.a });
  }
  for (const g of GALLERY_ITEMS) {
    out.push({ key: `tpl.${g.slug}.name`, text: g.name });
    out.push({ key: `tpl.${g.slug}.description`, text: g.description });
    g.roles.forEach((r, i) => out.push({ key: `tpl.${g.slug}.role.${i}`, text: r }));
  }
  return out;
}

const SYSTEM = `You are a professional SaaS localization translator for Docurama, a European electronic-signature platform.
Translate English strings into the target language with a warm, precise, professional tone (Notion-like clarity).
Rules:
- Preserve inline HTML tags exactly: <strong>, <code> and their placement.
- Never translate or transliterate product and standard names: Docurama, PAdES, eIDAS, ESIGN, RFC 3161, X.509, PKCS#12, AES-GCM, SHA-256, Stripe, OIDC, SAML, MCP, "Fair Exit Guarantee" (translate the words naturally but keep the English name in parentheses on first mention ONLY in long strings — otherwise keep "Fair Exit Guarantee" as-is).
- Keep placeholders, numbers, currency amounts (EUR), and dates unchanged.
- This platform never claims certifications. Any source text about compliance describes a "compliance program", "controls implemented", "readiness", or "evidence". Translate faithfully WITHOUT inventing certification claims; if the source says the platform does NOT claim certifications, keep that negation.
- Return STRICT JSON only: {"<key>": "<translation>", ...}. No markdown fences, no commentary.`;

// Vocabulary guard patterns per locale. They ban certification CLAIMS
// ("certified platform", "we hold certification") while allowing the noun
// "certificate" where it names a real artifact — e.g. the audit certificate
// (FR "certificat d'audit", ES "certificado de auditoría", DE "Zertifikat").
const BANNED: Record<string, RegExp> = {
  // FR/DE: ban the "certified"/"certification" claim words; the artifact noun
  // (certificat / Zertifikat) is allowed.
  fr: /certifi(?:é|ée|és|ées|cation|cations)\b/i,
  de: /zertifizier\w*/i,
  // ES: "certificado" is the correct noun for a certificate artifact, so ban
  // only certification claims: the abstract noun and adjective uses applied
  // to the platform ("plataforma certificada", "certificados por...").
  es: /\bcertificación(?:es)?\b|(?:plataforma|empresa|solución|servicio|estamos|somos)\s+(?:\w+\s+)?certificad\w*|certificad[oa]s?\s+(?:por|bajo|conforme)\b/i,
};

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function translateLocale(
  zai: any,
  locale: string,
  entries: Entry[],
  existing: Record<string, string>,
): Promise<{ dict: Record<string, string>; hits: string[]; done: number }> {
  const dict: Record<string, string> = { ...existing };
  const hits: string[] = [];
  const todo = FORCE ? entries : entries.filter((e) => !dict[e.key]);
  let done = 0;

  for (const batch of chunk(todo, BATCH)) {
    const payload: Record<string, string> = {};
    for (const e of batch) payload[e.key] = e.text;
    let parsed: Record<string, string> | null = null;
    for (let attempt = 1; attempt <= 5 && !parsed; attempt++) {
      try {
        const completion = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: SYSTEM },
            {
              role: 'user',
              content: `Target language: ${locale}\nTranslate these strings. Return strict JSON keyed by the exact same keys:\n${JSON.stringify(payload, null, 0)}`,
            },
          ],
          thinking: { type: 'disabled' },
        });
        const raw: string = completion.choices[0]?.message?.content ?? '';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (err) {
        const msg = (err as Error).message;
        // 429s need a real cool-down, not a token gesture.
        const wait = msg.includes('429') ? 12000 * attempt : 800 * attempt;
        console.warn(`  retry ${attempt} (${msg.slice(0, 80)}); waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (!parsed) {
      console.warn(`  batch skipped after retries (${batch.length} keys)`);
      continue;
    }
    for (const [key, text] of Object.entries(parsed)) {
      if (typeof text !== 'string' || !text.trim()) continue;
      const banned = BANNED[locale];
      if (banned && banned.test(text)) {
        // Compliance vocabulary guardrail: keep the English source instead of
        // a translation that could read as a certification claim.
        hits.push(key);
        continue;
      }
      dict[key] = text;
      done++;
    }
    process.stdout.write(`  ${locale}: ${done}/${todo.length}\r`);
    // Politeness delay between batches keeps the 429s away.
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('');
  return { dict, hits, done };
}

async function main() {
  const entries = buildEntries();
  console.log(`Corpus: ${entries.length} translatable strings`);
  const zai = await ZAI.create();

  for (const locale of LOCALES) {
    const file = `${OUT_DIR}${locale}.json`;
    const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    console.log(`\n== ${locale} == (${Object.keys(existing).length} existing)`);
    const { dict, hits, done } = await translateLocale(zai, locale, entries, existing);
    writeFileSync(file, JSON.stringify(dict, null, 2) + '\n');
    console.log(`  wrote ${Object.keys(dict).length} keys (${done} new) -> ${file}`);
    if (hits.length) {
      console.warn(`  GUARD: ${hits.length} certification-claim hits replaced by English fallback: ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ' …' : ''}`);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('pipeline failed:', e);
  process.exit(1);
});

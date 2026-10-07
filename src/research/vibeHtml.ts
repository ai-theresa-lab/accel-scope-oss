// Shared FREE-VIBE HTML engine — the author→reword→red-team core behind the leadership report (leadershipVibe).
// (Quick Ask no longer uses it — its report is the deterministic scoped template.) The caller supplies a complete PASS-1 author prompt
// (it embeds the material + the authoring rules, and is responsible for INPUT redaction of that material); this
// module runs the three independent LLM passes and the safety gates:
//
//   PASS 1 — free-authors a COMPLETE, self-contained, English-only HTML document from the
//     author prompt. Tool-free: it writes ONLY from the prompt material, never re-inspects the repo.
//   PASS 2 (gpt-5.5) — rewords the PROSE ONLY for an executive audience; gated so it can't drop/edit a number
//     or mangle structure (else PASS 1's HTML is kept).
//   PASS 3 (gpt-5.5) — an independent skeptical RED-TEAM that softens overclaims / appends caveats / drops weak
//     fixes (prose only); gated so it introduces NO new number (anti-fabrication).
//
// Output is secret-redacted at every acceptance point. Fail-open throughout: a failed/garbled pass keeps the
// prior HTML; PASS-1 failure returns null (the caller falls back to its own deterministic path).
import { runAgent } from './agent.ts';
import { openaiAvailable } from './openai.ts';
import { codexGptOrClaude } from './codexAgent.ts';
import { redactSecrets } from './reportEvidence.ts';
import { llmFailureReason, recordDegraded } from './budget.ts';
import { normalizeBrand } from '../reportChrome.ts';

// Pull the HTML document out of a reply that may carry prose or a code fence around it.
export function extractHtml(text: string): string | null {
  if (!text) return null;
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const lower = body.toLowerCase();
  let start = lower.indexOf('<!doctype html');
  if (start < 0) start = lower.indexOf('<html');
  const end = lower.lastIndexOf('</html>');
  if (start < 0 || end < 0 || end <= start) return null;
  return body.slice(start, end + '</html>'.length).trim();
}

const numbersIn = (s: string): string[] => (s.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/[,.]$/, ''));
// VISIBLE TEXT only: drop <style>/<script> blocks, then strip all tags + their attributes — leaving the text nodes
// (prose, table cells, chart text labels, SVG <text>). The faithfulness gates count numbers HERE, not in the raw
// HTML, so DATA numbers (always rendered as visible text) stay protected against fabrication/drift, while chart
// GEOMETRY — style widths, SVG path/x/y coordinates — is free to change. That lets the red-team REPAIR a visually
// broken chart/table (a bar width that contradicts its value, a malformed SVG) without the gate falsely rejecting
// it as a "new number", and stops legitimate prose rewords from being rejected over an incidental style digit.
export const visibleText = (html: string): string => html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
// A reword is accepted only if it stayed a real HTML doc of comparable size AND is number-LOSSLESS in BOTH
// directions over the VISIBLE TEXT: every original data number preserved (no dropped/edited figure) AND no NEW
// data number introduced (a polish must not fabricate). Either way → keep prior HTML.
export function rewordIsFaithful(orig: string, next: string | null): next is string {
  if (!next || next.length < orig.length * 0.6) return false;
  const ot = numbersIn(visibleText(orig)), nt = numbersIn(visibleText(next));
  const o = new Set(ot); const a = new Set(nt);
  return ot.every((n) => a.has(n)) && nt.every((n) => o.has(n));
}
// The red-team MAY drop a weak fix (so it needn't keep every number) and MAY repair chart/table geometry (not
// gated — geometry isn't visible text), but must introduce NO NEW DATA number (anti-fabrication, over visible
// text) and stay a real HTML doc of comparable size.
export function redTeamIsFaithful(orig: string, next: string | null): next is string {
  if (!next || next.length < orig.length * 0.5) return false;
  const o = new Set(numbersIn(visibleText(orig)));
  return numbersIn(visibleText(next)).every((n) => o.has(n));
}

// Deterministic bar-fill guard — the #1 silent CHART render bug in the free-vibe reports: an author writes a bar
// fill as an INLINE element carrying an inline percentage width — `<span class="fill" style="width:83.7%">` — but
// inline elements IGNORE width, so the fill collapses to 0px and EVERY bar looks identical regardless of its value.
// The gpt red-team can't catch it: the width NUMBER is correct (83.7% == value/scale), and it reviews the markup as
// TEXT, never a real render. Add `display:inline-block` to any inline fill (<span>/<a>) whose inline style sets a
// %-width, so the width physically renders. We do NOT override a display the author already set — either INLINE on
// the element, or via a <style> rule for its class (e.g. the deterministic renderer's `.bar .fill{display:block}`,
// or an intentional `.fill{display:flex}`) — so a block-level fill keeps its own display. Idempotent; bounded regex.
export function repairBarFills(html: string): string {
  // Classes that already receive a `display` from a <style> rule — never override the author's stylesheet display.
  const css = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
  const styledDisplay = new Set<string>();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\bdisplay\s*:/i.test(rule[2])) continue;
    for (const sel of rule[1].matchAll(/\.([\w-]+)/g)) styledDisplay.add(sel[1]);
  }
  return html.replace(/<(?:span|a)\b[^>]*>/gi, (tag) => {
    const sm = tag.match(/\bstyle\s*=\s*(["'])([^"']*?)\1/i);
    if (!sm || !/width\s*:\s*\d[\d.]*%/i.test(sm[2]) || /\bdisplay\s*:/i.test(sm[2])) return tag;   // no %-width, or display already inline
    const cls = (tag.match(/\bclass\s*=\s*(["'])([^"']*)\1/i)?.[2] || '').split(/\s+/);
    if (cls.some((c) => c && styledDisplay.has(c))) return tag;   // a <style> rule already gives this fill a display
    const fixed = sm[0].replace(sm[2], sm[2].replace(/\s*;?\s*$/, '') + ';display:inline-block');
    return tag.replace(sm[0], fixed);
  });
}

function rewordPrompt(html: string): string {
  return `You are a senior editor polishing a finished English report. Below is the COMPLETE
HTML. Return the COMPLETE HTML again, IDENTICAL in every respect EXCEPT that you may improve the WORDING of the
natural-language sentences for a busy executive: clearer, tighter, a confident tone, no
jargon. This is a language polish ONLY.

ABSOLUTE constraints (a violation makes your output unusable):
• Do NOT add, remove, reorder, or rename any HTML tag, attribute, class, id, inline style, or <script>.
• Do NOT change the document structure, the layout, or ANY chart / SVG / table markup.
• Do NOT change ANY number, percentage, ratio, count, or data value — not one digit.
• Keep it in English.
• Only the human-readable text inside elements may change. Everything else is byte-for-byte preserved.

OUTPUT: ONLY the HTML, starting with <!DOCTYPE html> (or <html>) and ending with </html>. No fence, no notes.

THE HTML:
${html}`;
}

function redTeamPrompt(html: string): string {
  return `You are a SKEPTICAL RED-TEAM reviewer of a finished English report (the complete HTML
below). It already presents grounded findings — you do NOT add findings or data numbers. You have TWO jobs:

(A) PROSE discipline — where the prose overclaims beyond the evidence, misses a load-bearing caveat, or ships a
    WEAK / hand-wavy recommendation, make a MINIMAL surgical edit: soften the overclaim, append a short caveat, or
    drop the weak recommendation. Conservative — changing nothing here is a fine outcome.
    WHERE a caveat goes: in the SECTION that carries the claim, never appended to the opening "Bottom line" bullets.
    Those three bullets are the one thing every reader finishes; a trailing "— while several open items still need X
    before Y can be quantified" is exactly the tail that makes them unreadable. If a Bottom-line bullet overclaims,
    FIX THE CLAIM IN PLACE (say the weaker true thing) or drop the bullet's overreaching half — do not lengthen it.
    Same for stacked qualifiers: one hedge per sentence. Prefer deleting an unsupported clause over hedging it.

(B) CHART / TABLE REPAIR — inspect every chart and table; if one would render VISIBLY WRONG, FIX the markup so it
    faithfully shows its OWN numbers (you may change geometry — widths, SVG coordinates, viewBox — but never a DATA
    number/label):
    • a bar whose WIDTH contradicts its labeled value on its scale (e.g. a 0–1 AUC bar where 0.456 is drawn far from
      ~46% of the track) → correct the width to match the value;
    • a bar fill that sets a percentage width but is an INLINE element (a bare <span>/<a> with no
      display:block/inline-block) → an inline element IGNORES width, so the fill renders 0px and EVERY bar looks
      identical regardless of value; add display:inline-block to the fill (do NOT change its width value);
    • a table where a row's cell count ≠ the header, columns misalign, or a cell is empty by accident → fix the cells;
    • malformed / clipped SVG (coords outside the viewBox, overlapping segments, donut angles that don't sum) → fix it;
    • a chart that is hopelessly broken and can't be salvaged faithfully → remove it (its prose stays).

ABSOLUTE constraints (a violation makes your output unusable):
• Return the COMPLETE HTML. Keep the house style, the section order, and all DATA numbers/labels.
• Change NO data number, percentage, ratio, or count in any VISIBLE text or label; introduce NO new number or finding.
  (Chart GEOMETRY — bar widths, SVG path/x/y coords — is NOT a data number; you may adjust it to fix a chart.)
• Keep it in English.

OUTPUT: ONLY the HTML, starting with <!DOCTYPE html> (or <html>) and ending with </html>. No fence, no notes.

THE HTML:
${html}`;
}

// Completeness gate — the authored report must carry a substantial English rendering. Returns a reason when the
// report would render near-empty, else null. Exported for the test.
export function englishGapReason(html: string): string | null {
  const latin = (visibleText(html).match(/[A-Za-z]{3,}/g) ?? []).length;
  if (latin < 80) return `English rendering too thin (${latin} words)`;
  return null;
}
const ENGLISH_RETRY = `

────────
CRITICAL — YOUR PREVIOUS ATTEMPT FAILED THE COMPLETENESS CHECK: the report was near-empty. REWRITE it as ONE complete
English report carrying EVERY section, lead card, metric label, table cell, chart label, bullet and note.`;

// Appended to EVERY author prompt (defense-in-depth alongside the deterministic repairBarFills guard): the most
// common chart render bug is a bar fill authored as an inline <span> with a %-width, which renders 0px.
const CHART_FILL_RULE = `

────────
CHART RULE — bar charts: a horizontal bar's FILL must be a BLOCK-LEVEL element. When you set a percentage width on a
fill (e.g. style="width:83.7%"), that element MUST be display:block or display:inline-block — an INLINE element such
as a bare <span> IGNORES width, so the bar renders 0px wide and every bar looks identical regardless of its value.
Use a <div> for the fill, or add display:inline-block to the <span>. (Same for the track if it constrains width.)`;

export interface VibeHtmlResult { html: string; reworded: boolean; redTeamed: boolean; costUsd: number; }
export interface VibeHtmlOpts {
  authorPrompt: string;          // the COMPLETE PASS-1 prompt (material already input-redacted by the caller)
  model?: string;
  authToken?: string;
  maxTurns?: number;             // PASS-1 turns (default 6 — pure authoring)
  label?: string;                // PASS-1 agent label
  log?: (m: string) => void;
  onCost?: (usd: number) => void;
  degradeStage?: string;         // run.degraded stage for a skipped/failed reword (default 'report-writer'; red-team is always 'report-redteam')
}

// PASS 2 (reword) + PASS 3 (red-team) over an authored document. They run on OpenAI when a key is configured and on
// Claude otherwise (codexGptOrClaude). Both are fail-open, but never SILENT: a pass that fails records a run.degraded
// row, so a report that shipped un-red-teamed says so in the run banner instead of only in the log. Exported for the test.
export async function vibePolishPasses(html: string, opts: Pick<VibeHtmlOpts, 'label' | 'degradeStage' | 'onCost'>, log: (m: string) => void): Promise<{ html: string; reworded: boolean; redTeamed: boolean; costUsd: number }> {
  const label = opts.label ?? 'vibe-report';
  let cost = 0;
  const model = openaiAvailable() ? 'gpt-5.5' : 'Claude';
  // PASS 2 — reword prose only (fail-open).
  let reworded = false;
  {
    try {
      const or = await codexGptOrClaude({ files: { 'task.md': rewordPrompt(html) }, codexPrompt: 'Read task.md — full instructions + the current report HTML. Produce the reworded report (prose polished for an executive audience; EVERY number and the structure preserved) and WRITE the complete HTML document to output.html.', outputFile: 'output.html', fallbackPrompt: rewordPrompt(html), maxTokens: 32000, label: 'leadership-reword', log });
      cost += or.costUsd; opts.onCost?.(or.costUsd);
      const polished = extractHtml(or.text);
      if (rewordIsFaithful(html, polished)) { html = redactSecrets(polished); reworded = true; log(`  ↳ ${model} reworded the prose (numbers + structure preserved)`); }
      else log(`  ⚠ ${model} reword rejected (${polished ? 'number/structure drift' : 'truncated / no </html>'}) — keeping authored HTML`);
    } catch (e) {
      log(`  ⚠ ${model} reword failed (${e instanceof Error ? e.message : String(e)}) — keeping authored HTML`);
      recordDegraded(opts.degradeStage ?? 'report-writer', `${label}: prose reword failed: ${llmFailureReason(e instanceof Error ? e.message : String(e))} — shipped the authored draft`);
    }
  }

  // PASS 3 — red-team: overclaim / caveat / weak-fix discipline (fail-open).
  let redTeamed = false;
  {
    try {
      const rt = await codexGptOrClaude({ files: { 'task.md': redTeamPrompt(html) }, codexPrompt: 'Read task.md — full instructions + the current report HTML. Apply the red-team (fix overclaims / add missing caveats / strengthen weak fixes; NEVER fabricate a number; preserve structure) and WRITE the complete reviewed HTML document to output.html.', outputFile: 'output.html', fallbackPrompt: redTeamPrompt(html), maxTokens: 32000, label: 'leadership-redteam', log });
      cost += rt.costUsd; opts.onCost?.(rt.costUsd);
      const reviewed = extractHtml(rt.text);
      if (redTeamIsFaithful(html, reviewed)) { html = redactSecrets(reviewed); redTeamed = true; log(`  ↳ ${model} red-team reviewed the report (no fabricated numbers; structure preserved)`); }
      else log(`  ⚠ ${model} red-team rejected (${reviewed ? 'new number / structure drift' : 'truncated / no </html>'}) — keeping prior HTML`);
    } catch (e) {
      log(`  ⚠ ${model} red-team failed (${e instanceof Error ? e.message : String(e)}) — keeping prior HTML`);
      recordDegraded('report-redteam', `${label}: red-team failed: ${llmFailureReason(e instanceof Error ? e.message : String(e))} — report shipped un-reviewed`);
    }
  }

  return { html, reworded, redTeamed, costUsd: cost };
}

export async function vibeHtml(opts: VibeHtmlOpts): Promise<VibeHtmlResult | null> {
  const log = opts.log ?? (() => {});
  let cost = 0;

  // PASS 1 — Claude free-authors the English HTML (tool-free: author only from the prompt material). One
  // re-author retry if the completeness gate fails.
  let html: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let candidate: string | null = null;
    try {
      const base = opts.authorPrompt + CHART_FILL_RULE;
      const prompt = attempt === 1 ? base : base + ENGLISH_RETRY;
      const r = await runAgent({ cwd: process.cwd(), model: opts.model, authToken: opts.authToken, maxTurns: opts.maxTurns ?? 6, label: (opts.label ?? 'vibe-html') + (attempt > 1 ? '-retry' : ''), prompt, toolFree: true });
      cost += r.costUsd; opts.onCost?.(r.costUsd);
      candidate = extractHtml(r.allText || r.text);
    } catch (e) { log(`  ⚠ HTML authoring failed (${e instanceof Error ? e.message : String(e)})${attempt < 2 ? ' — retrying' : ''}`); }
    if (!candidate) { if (attempt < 2) continue; break; }
    candidate = redactSecrets(candidate);   // output redaction (defense-in-depth)
    // The completeness gate, one retry. A retry only REPLACES the first candidate when it passes the gate, so a
    // retry can never make the report worse.
    const gap = englishGapReason(candidate);
    if (!html || !gap) html = candidate;
    if (!gap) { log(`  ↳ authored ${candidate.length} chars of HTML${attempt > 1 ? ' (retry)' : ''}`); break; }
    if (attempt === 1) { log(`  ⚠ English rendering incomplete (${gap}) — re-authoring once`); continue; }
    log(`  ⚠ English rendering STILL incomplete after retry (${gap}) — shipping best effort`);
  }
  if (!html) { log('  ⚠ author pass returned no parseable HTML document — vibe unavailable'); return null; }

  const polished = await vibePolishPasses(html, opts, log);
  html = polished.html; cost += polished.costUsd;
  const { reworded, redTeamed } = polished;

  // Deterministic safety net: ensure every percentage-width bar fill actually renders (see repairBarFills) — runs
  // LAST so the shipped HTML is correct regardless of what the author / reword / red-team passes produced.
  html = repairBarFills(html);
  html = normalizeBrand(html);   // one brand string, even when the author hard-coded its own casing
  return { html, reworded, redTeamed, costUsd: cost };
}

// Leadership report — the "free-vibe" two-pass path (alternative to the structured leadershipWriter).
//
//   PASS 1 — free-authors a COMPLETE, self-contained, English HTML report directly from the
//     verdicts + the reader's intake. No fixed RecallReportInput / no fixed viz vocabulary: Claude lays
//     out the issues + the answers to each intake question however best fits, drawing its OWN inline
//     SVG/CSS charts from the measured numbers. Value-free: it may only restate measured numbers + the
//     run's verdicts, never invent.
//   PASS 2 (gpt-5.5) — rewords the PROSE ONLY for an executive audience (clarity + leadership tone). It
//     may not touch structure, tags, classes, scripts, charts, or any number — pure language polish.
//
// Same input context as the structured writer (LeadershipWriterOpts), but per verdict it carries the
// RECONCILING fields the rows alone cannot express — the note's opening, the claim boundaries and the fix
// lever — which is what stops the "no eviction policy" misread. Those fields are CAPPED, and the raw
// sample rows are not sent at all: see verdictMaterial for why the brief is not the engineering report.
// Fail-open: gpt-5.5 reword failure → Claude's HTML; Claude failure → null
// (the caller falls back to the structured writer).
import { vibeHtml } from './vibeHtml.ts';
import { openaiAvailable } from './openai.ts';
import { codexGptOrClaude } from './codexAgent.ts';
import { extractJson } from './json.ts';
import { type LeadershipWriterOpts, authorAnswerBack, authorHypotheses, effectiveVariant, lensAnswerBack, lensMaterialBlock, lensSplitOn, planeDisplayName } from './leadershipWriter.ts';
import { normalizeV5ShapeReport, tightenV5 } from './leadershipShape.ts';
import { lensCountsOf } from '../findingLens.ts';
import { contractFor } from './leadershipContracts.ts';
import { injectDetailIndex } from '../reportAnchors.ts';
import { type ProvenanceClass, externalSourceOf, measurePlaneNames, planeOf, provenanceClassOf } from './evidencePlane.ts';
import { currentPlaneManifest } from './planeManifest.ts';
import type { Hypothesis, Measurement } from './investigation.ts';
import type { Mitigation } from './deep.ts';
import { redactSecrets } from './reportEvidence.ts';
import { llmFailureReason, recordDegraded } from './budget.ts';
import { FREE_VIBE_CONTRACT } from './reportContract.ts';
import { EFFORT_LABELS, LEADERSHIP_SHAPE_BRIEF, LEADERSHIP_SHAPE_BRIEF_V5, leadershipAdvisories } from './htmlQc.ts';
// House style + recsys glossary live in the shared report contract now (one source of truth for both reports).
export { THERESA_STYLE, RECSYS_GLOSSARY } from './reportContract.ts';

type Disp = 'confirmed' | 'healthy' | 'open';
function disposition(h: Hypothesis, mit: Map<string, Mitigation>): Disp {
  const m = h.measurement as Measurement | undefined; const measured = Boolean(m && m.value != null);
  if (!measured || h.status === 'blocked-need-eval') return 'open';
  if (mit.has(h.id)) return mit.get(h.id)!.supported ? 'confirmed' : 'healthy';
  return h.status === 'supported' ? 'confirmed' : h.status === 'refuted' ? 'healthy' : 'open';
}

// The verdict material handed to Claude — richer than the structured writer's rows, but no longer the
// whole record: the note's opening, the claim boundaries and the fix lever, each CAPPED, and no raw rows.
// The reconciliation this enables (Σ-members vs distinct-union, "inferred, not source-confirmed") rides on
// the note's FIRST sentence, which states the mechanism; the rows under it were the file:line trail that
// proved the mechanism, and a leadership brief never renders one. Checked rather than assumed — a baseline
// run on the same checkpoints covered the same 10 of 12 findings, both reconciliations intact.
// Which live plane produced a hypothesis's value, if any. Same ref the Finding's Evidence.kind is derived
// from (deep.ts), read through the same classifier, so the report and the findings can never disagree
// about what "measured" means.
function measuredPlaneOf(h: Hypothesis): string | undefined {
  const m = (h.measurement ?? {}) as Measurement & Record<string, unknown>;
  if (m.value == null) return undefined;
  const ref = ((m as { evidence?: { source?: string } }).evidence?.source) ?? m.source ?? '';
  // measurePlaneNames, NOT the raw manifest: a reference-only plane (repogrep) must never confer the
  // MEASURED stamp on what is actually a code read. See evidencePlane.measurePlaneNames.
  return planeOf(ref, measurePlaneNames(currentPlaneManifest()));
}

function refOf(h: Hypothesis): string {
  const m = (h.measurement ?? {}) as Measurement & Record<string, unknown>;
  return ((m as { evidence?: { source?: string } }).evidence?.source) ?? m.source ?? '';
}

// THREE states, not two. See evidencePlane.provenanceClassOf: collapsing "not a live plane" into "read from
// code" was false for a recorded eval datapoint or an advisory lookup, and under-sold real measurement with
// the same confidence the original bug over-sold code reads.
function provenanceOf(h: Hypothesis): ProvenanceClass {
  // GUARDED ON A VALUE. measuredPlaneOf() had this check and provenanceOf() dropped it, so an unmeasured
  // hypothesis that legitimately keeps `source: 'warehouse:…'` rendered the self-contradicting block
  // `[OPEN] [MEASURED · warehouse]` above `measured: not measured (needs an eval)`. No value, no
  // measurement — whatever the source says.
  const m = (h.measurement ?? {}) as Measurement;
  if (m.value == null) return 'code';
  return provenanceClassOf(refOf(h), measurePlaneNames(currentPlaneManifest()));
}

// The verdict's provenance LABEL, which is what the writer is told to render. Each label says only what it
// can support: a live plane names itself, an external measurement says it happened but not against a running
// system, and everything else says it was read from the source.
function provenanceLabel(h: Hypothesis): string {
  const cls = provenanceOf(h);
  // Plane names go through planeDisplayName: this label is RENDERED by the author, so a raw codename here
  // ("RECORDED via repometa") surfaced verbatim in the brief.
  if (cls === 'live') { const p = measuredPlaneOf(h); return `MEASURED · ${p ? planeDisplayName(p) : 'live system'}`; }
  if (cls === 'external') {
    const src = externalSourceOf(refOf(h));
    return `MEASURED · RECORDED via ${src ? planeDisplayName(src) : 'an external source'} (a real measurement, but not a live query in this run)`;
  }
  return 'READ FROM CODE';
}

// MEASURED vs RECORDED vs READ, counted deterministically over the verdicts the report is written from.
export function measuredSplit(hypotheses: Hypothesis[], mitigations: Mitigation[] = []): { measured: number; total: number; external: number; planes: string[]; externalSources: string[] } {
  const planes = new Set<string>();
  const externalSources = new Set<string>();
  const mit = new Map(mitigations.map((m) => [m.hypothesisId, m]));
  let measured = 0; let external = 0; let total = 0;
  for (const h of hypotheses) {
    const m = (h.measurement ?? {}) as Measurement;
    if (m.value == null) continue;      // unmeasured hypotheses are coverage gaps, not report claims
    // A VALUE IS NOT A FINDING. hypothesesToFindings routes a measured-but-UNDISPOSED hypothesis to a
    // CoverageGap, so counting it here made the banner say "N findings measured against your systems" about
    // rows that never became findings. Same disposition test as the converter.
    if (disposition(h, mit) === 'open') continue;
    total++;
    const cls = provenanceOf(h);
    if (cls === 'live') { measured++; const p = measuredPlaneOf(h); if (p) planes.add(p); }
    else if (cls === 'external') { external++; const src = externalSourceOf(refOf(h)); if (src) externalSources.add(src); }
  }
  return { measured, total, external, planes: [...planes].sort(), externalSources: [...externalSources].sort() };
}

// Truncate the reader's intake with an EXPLICIT marker. Both prompts command "answer EACH ask, in their order",
// so a silent slice drops asks the report is still judged on — the same failure dossierForPrompt documents
// ("never slice the whole blob ... while QC still demands coverage").
function cut(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…[the reader's request was TRUNCATED here: +${s.length - n} more characters. Say plainly in the report that the later asks were not covered — never silently drop them.]` : s;
}

// THIS MATERIAL IS FOR THE LEADERSHIP BRIEF, NOT THE ENGINEERING REPORT. The same hypotheses feed both, and the
// area report needs every field — but the brief never renders a file path, and it was being handed all of them:
// measured on a real run, `detail` + `bounds` + `raw rows` were 55% of the 24KB of material, and `raw rows` is
// nothing but `package.json:19`-style lines. Because codex re-sends the whole prompt on each step of its agentic
// loop (one measured digest call: 8.6K-token prompt → 151K input tokens, a ~17x multiplier), every character cut
// here is cut ~17 times. So: drop the raw rows outright, and CAP the prose fields rather than deleting them —
// the useful half of a `note` is its opening mechanism sentence, and the tail is the file trail.
// REDACT BEFORE TRUNCATING, not after. The join below is redacted as a whole, but that runs after this cap,
// and a secret straddling the cut would already have been sliced into a fragment the redaction patterns no
// longer recognise. Redacting the field first means the cut can only ever land inside `[redacted-…]`.
// (Review catch. Low severity — the tail is dropped, so a split fragment is less exposure than the
// whole value — but the reason the input-redaction step below exists is that notes can carry secrets.)
const cap = (raw: string, n: number): string => {
  const s = redactSecrets(raw);
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
};

// the evidence-tier BADGE the brief renders per finding, derived (never authored) from the same provenance +
// disposition the label above uses: an open item needs a test; a live or recorded measurement is Measured; the rest
// was read from code.
export function evidenceTierOf(h: Hypothesis, mit: Map<string, Mitigation>): 'Measured' | 'Read from code' | 'Needs a test' {
  if (disposition(h, mit) === 'open') return 'Needs a test';
  return provenanceOf(h) === 'code' ? 'Read from code' : 'Measured';
}
// effort, ONLY when the material carries one (a mitigation / hypothesis `effort`); never inferred.
export function effortOf(h: Hypothesis, mit: Map<string, Mitigation>): string | undefined {
  const raw = String((mit.get(h.id) as { effort?: unknown } | undefined)?.effort ?? (h as { effort?: unknown }).effort ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return undefined;
  const key = raw === 'project' || raw === 'big' ? 'large' : raw;
  return EFFORT_LABELS.find((e) => e.key === key)?.label;
}

function verdictMaterial(opts: LeadershipWriterOpts): string {
  const mit = new Map(opts.mitigations.map((m) => [m.hypothesisId, m]));
  // Lens split (v5): the business verdicts only, each with the capability its card belongs to. Off ⇒ every hypothesis,
  // and no capability line, so v0 / v4 material is unchanged byte for byte.
  const split = lensSplitOn(opts);
  const blocks = authorHypotheses(opts).map((h, i) => {
    const m = (h.measurement ?? {}) as Measurement & Record<string, any>;
    const d = disposition(h, mit);
    const val = m.value != null ? (typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value)) : 'not measured (needs an eval)';
    const lever = mit.get(h.id)?.lever;
    const effort = effortOf(h, mit);
    // PROVENANCE ON THE BLOCK. Without it the writer cannot tell a value queried from the project's
    // warehouse from one read out of their source, and every finding in the brief reads equally
    // authoritative — which is exactly how a report that was 91% code-reading looked like one that was
    // 63% measured.
    return [
      `[${d.toUpperCase()}] [${provenanceLabel(h)}] ${h.claim}`,
      `    measured: ${val}`,
      `    evidence tier: ${evidenceTierOf(h, mit)}`,
      effort ? `    effort: ${effort}` : '',
      m.note ? `    detail: ${cap(m.note, 240)}` : '',
      (m as any).claimBoundaries ? `    bounds: ${cap(String((m as any).claimBoundaries), 140)}` : '',
      (m as any).metricSemantics?.cannotProve ? `    cannot prove: ${cap(String((m as any).metricSemantics.cannotProve), 140)}` : '',
      lever ? `    fix lever: ${cap(lever, 220)}` : '',
      split && opts.lens!.capabilityOf[h.id.toLowerCase()] ? `    capability: ${opts.lens!.capabilityOf[h.id.toLowerCase()]}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  // INPUT REDACTION (bucket-3): a committed secret echoed in a verdict note/sample must never reach the model
  // (which would otherwise be free to author it into raw HTML). The structured path got this via the renderer's
  // sanitizeReportInput; the free-vibe path has no renderer, so we redact the material itself.
  return redactSecrets(blocks);
}

// The Bottom-line contract — ONE definition. It used to be written twice (buildDigest plans the bullets, vibePrompt
// authors them), which is exactly how a fix landed on the planner while the author kept the old rule. Both now
// interpolate this constant, so they cannot drift apart again.

// A planned report skeleton: a TL;DR that DIRECTLY answers each reader ask, and the section outline whose job is
// to back the TL;DR with evidence. Authored by gpt-5.5 BEFORE the free-vibe HTML so the structure is tight and
// reader-driven (instead of whatever PASS-1 free-forms). PASS-1 renders it styled.
interface DigestMetric { value: string; label: string }
interface Digest { tldr: string[]; sections: { n: string; heading: string; serves?: string; thesis: string; evidence: string[]; metrics?: DigestMetric[] }[]; }

// STEP 0 (gpt-5.5) — plan the TL;DR + sections from the intake + verdicts. Returns null when OpenAI is unset or the
// output is unusable → the caller falls back to PASS-1's own free-form TL;DR (current behavior). Value-free.
// The digest prompt, EXPORTED as a pure function so the Bottom-line rules can be diffed and A/B'd against a real
// run's verdicts without calling a model (leadershipPrompt.ab.ts). Same seam as areaReportBrief / htmlBrief.
export function digestPrompt(opts: LeadershipWriterOpts): string {
  const inquiry = redactSecrets((opts.inquiry ?? '').trim());
  const c = contractFor(effectiveVariant(opts));
  return `${c.digestOpening(opts.systemKind)}
Produce a tight DIGEST: a BOTTOM LINE (an informative bulleted executive summary that directly answers the reader's
request) + the section outline whose only job is to back each bottom-line bullet with evidence. Value-free: use ONLY
the measured numbers + verdicts below; invent NOTHING.

THE READER'S REQUEST — answer EACH ask, in their order:
"""
${cut(inquiry, 1600)}
"""

VERDICTS — the only material:
"""
${verdictMaterial(opts)}
"""
${lensMaterialBlock(opts)}
Output ONLY this JSON (no prose, no code fence):
{"tldr":["<a succinct DECLARATIVE statement of a bottom-line finding, carrying its decisive number>"],
 "sections":[{"n":"01","heading":"<short business heading>","serves":"<the TL;DR statement this backs>","thesis":"<the one-sentence claim>","metrics":[{"value":"<the number, as it should read on a card: 0 · 12.4x · 100%>","label":"<what it counts, in plain words a non-engineer reads alone>"}],"evidence":["<a measured number / verdict that proves it>"]}]}
${c.digestRules}`;
}

async function buildDigest(opts: LeadershipWriterOpts, log: (m: string) => void): Promise<Digest | null> {
  const prompt = digestPrompt(opts);
  try {
    const r = await codexGptOrClaude({ files: { 'task.md': prompt }, codexPrompt: 'Read task.md — full instructions + the measured verdicts. Plan the TL;DR + evidence sections it asks for, then WRITE the plan as JSON (matching task.md: {tldr, sections}, no prose/fences) to digest.json.', outputFile: 'digest.json', fallbackPrompt: prompt, maxTokens: 4000, label: 'leadership-digest', log });
    opts.onCost?.(r.costUsd);
    const d = extractJson<Digest>(r.text);
    if (d && Array.isArray(d.tldr) && d.tldr.length && Array.isArray(d.sections) && d.sections.length) {
      log(`  ↳ digest: ${d.tldr.length} TL;DR answer(s) · ${d.sections.length} section(s) planned`);
      return d;
    }
    recordDegraded('leadership-writer', 'TL;DR digest unparseable — the author free-formed the structure');
  } catch (e) {   // fail-open → PASS-1 free-forms the TL;DR
    recordDegraded('leadership-writer', `TL;DR digest failed: ${llmFailureReason(e instanceof Error ? e.message : String(e))} — the author free-formed the structure`);
  }
  return null;
}

// Render the approved digest as the PASS-1 structural spec: the TL;DR to open with (verbatim, one per ask) and the
// section order each section must follow. PASS-1 RENDERS this (styled), it does NOT re-plan.
function digestBlock(d: Digest): string {
  const tl = d.tldr.map((t) => `  • ${redactSecrets(t)}`).join('\n');
  const sec = d.sections.map((s) => {
    // The planner's chosen numbers ARE the section's metric-card row — render them, or the digest-side rule that
    // asks for them is inert and the card guarantee rests on the author prompt alone.
    const mx = (s.metrics ?? []).filter((m) => m && m.value != null && m.label != null)
      .map((m) => `${redactSecrets(String(m.value))} — ${redactSecrets(String(m.label))}`).join(' | ');
    return `  [${s.n}] ${redactSecrets(s.heading)}${s.serves ? ` (backs TL;DR: ${redactSecrets(s.serves)})` : ''}\n      thesis: ${redactSecrets(s.thesis)}${mx ? `\n      metric cards: ${mx}` : ''}\n      evidence: ${(s.evidence || []).map((e) => redactSecrets(e)).join(' · ')}`;
  }).join('\n');
  return `APPROVED DIGEST — a planning step already distilled the bottom line and chose the evidence. RENDER this skeleton;
do NOT re-plan, re-order, drop, or invent a different summary or different sections.
BOTTOM LINE (render as the SINGLE opening block — a "Bottom line" lead card containing these INFORMATIVE
bullets as a real <ul> with visible bullets, in THIS order. This one block IS the executive summary —
do NOT also add a separate thin "TL;DR" list or a separate bottom-line paragraph; do NOT render these as prose):
${tl}
SECTIONS (render IN THIS ORDER; each backs a Bottom-line bullet — open on the metric cards listed for it, then the
one-line thesis, then the evidence as a BULLET LIST (not a paragraph) + a chart where it helps):
${sec}`;
}

// The author's LAYOUT rules, split into three constants so the report-lens-split arm (v5) can keep the vocabulary rule
// and drop the section / metric-card / chart / three-bullet-opening rules its own contract replaces. v0 / v4 assemble the
// three back VERBATIM (leadershipControlArm.test.ts pins the bytes), so the split changes no existing prompt.
const HOUSE_LAYOUT_RULES = `THIS IS A LEADERSHIP BRIEF: FEWER WORDS, MORE PICTURES, MORE NUMBERS. The reader skims it between meetings and
does not read paragraphs. These are COUNTABLE requirements, not style advice:
• EVERY section opens with a ROW OF METRIC CARDS (1-3 big numbers with short labels) — the number is the headline,
  the sentence is the caption. Never open a section with prose. (The closing "Checked & ruled out" note is NOT a
  section: it stays a terse line each, with no metric cards and no chart.)
• EVERY section that compares, ranks, splits or trends anything ACROSS THREE OR MORE VALUES carries a CHART
  (inline SVG, or the house bar rows) — and a chart is worthless without its one-line takeaway underneath.
  A comparison of TWO values is a stat tile, not a chart; see WHEN NOT TO DRAW ONE below, which governs.
  A report with nothing plotted has failed ONLY if it had something plottable. If nothing in the material
  reaches three compared values, ship no chart and say the numbers — NEVER invent a value to earn one.
• PROSE IS RATIONED: at most TWO short bullets per section, each one line. No <p> paragraph anywhere except the one
  sentence under the title. If you need a third bullet, you are writing the engineering report, not this one.`;

const VOCABULARY_RULE = `• TRANSLATE THE VOCABULARY — a ban is not enough, because these words come out of the verdicts and copying them
  feels faithful. It is not faithful, it is untranslated. Substitute, every time, including inside chart labels,
  metric-card captions and section headings:
      workflow / CI / pipeline           → "the automatic checks that run before code ships"
      type-check / test / status check   → "an automatic check"
      scorer / recall / precision        → "the yardstick the audit scores itself with" / "how much it catches" /
                                            "how often it is right"
      sign-off / LGTM                    → "an approval"
      commit / SHA / revision / tag      → "a specific version of the code"
      lockfile / dependency closure      → "the pinned list of outside code we pull in"
      repo / codebase / script           → "the product" / "the system" / name what it DOES
  Keep the NUMBER exactly; translate only the noun around it. If a phrase would mean nothing to someone who has
  never opened this codebase, it does not ship.
  THE LABELS ARE WHERE THIS RULE GETS FORGOTTEN. Prose gets translated and then the same jargon reappears in a
  chart axis, a metric-card caption or a section heading — where it is WORSE, because a label has no sentence
  around it to explain it. Real failures from the last run of this report: a chart with rows "recall / precision",
  a card captioned "scorer", an axis reading "recall formula".
  BEFORE YOU EMIT, READ EVERY LABEL ON ITS OWN — every chart row, every axis, every metric-card caption, every
  section heading — and ask whether someone who has never opened this codebase knows what it means. If not,
  rewrite it. "two yardsticks give the same run different results" is a label; "recall formula" is not.`;

const OPENING_RULE = `THE OPENING IS ONE PASS, NOT THREE. The page title, any scope/summary line under it, and the three Bottom-line
bullets are read back-to-back, so between them they must carry FOUR DIFFERENT THINGS:
• The TITLE names the verdict on the SYSTEM — the thing a reader repeats to a colleague. If the title states a
  finding, that finding does NOT also get a Bottom-line bullet; move the next issue up. A title assembled from
  bullet 1 + bullet 2 ("X has no gate, and Y is scored two ways") is the most common failure and is NOT acceptable.
• The line under the title says what was audited and what the reader asked — ONE sentence, and never a restatement
  of any bullet. The run's scope/date already render as a separate small meta line; do not repeat them in prose.
• Each Bottom-line bullet then ADDS an issue the reader has not met yet.
Before you emit them, read the title and the three bullets in sequence: if any two say the same thing in different
words, you have wasted the reader's first screen — rewrite so each earns its place.`;

// v5 (lens split): the shape is the content contract's (verdict · decisions · one card per capability) and the ONE
// picture is the injected capability map, so the house layout rules above would contradict it.
const LENS_LAYOUT_RULES = `THIS IS A LEADERSHIP BRIEF: FEW WORDS, ONE PICTURE. The picture is the capability map, which is injected
deterministically after you; the shape of everything you write is fixed by the LEADERSHIP CONTENT contract below, and
it has no sections, no metric-card rows and no charts of your own.`;

// EXPORTED alongside digestPrompt so the AUTHOR prompt is testable too — the leadership-density and
// de-jargoning rules live here, and an untested prompt is where a rule silently goes missing.
export function vibePrompt(opts: LeadershipWriterOpts, digest: Digest | null): string {
  const inquiry = redactSecrets((opts.inquiry ?? '').trim());
  const ab = authorAnswerBack(opts);
  const c = contractFor(effectiveVariant(opts));
  // v5 (lens split): the answer-back is INJECTED deterministically after the capability cards (reportAnchors.answerBackHtml)
  // — the rows reach the author as context for emphasis only, never as a passage to write.
  const rowLine = (r: (typeof ab)[number]): string => `- [${r.status === 'supported' ? 'SUPPORTED — a real problem we confirmed' : r.status === 'refuted' ? 'RULED OUT — checked, healthy' : 'COULD NOT SETTLE'}] ${redactSecrets(r.concern)}${r.testedVia ? ` (checked via ${redactSecrets(r.testedVia)})` : ''}${r.nextDecisiveTest ? ` — next test: ${redactSecrets(r.nextDecisiveTest)}` : ''}`;
  const abBlock = ab.length && c.lensSplit ? `
ANSWER-BACK — the user named specific concerns. A deterministic "What you asked us to check" block (one line per
concern: its status, its capability, its finding id) is INJECTED after your capability cards. Do NOT write an
answer-back, an "at a glance" / TL;DR list, a KPI strip or any restatement of the asks, in either view. The rows below
are context — to weigh the verdict and the decisions — and are rendered faithfully by that block:
${ab.map(rowLine).join('\n')}
` : ab.length ? `
ANSWER-BACK — the user named specific concerns; weave a short "what you asked us to check" passage that maps
EACH row to our finding, rendering it FAITHFULLY by status. Do NOT recategorize a row: a "could not settle" is
never presented as confirmed or ruled out, and a brief worry with no row here was simply not evidenced.
${ab.map(rowLine).join('\n')}
` : '';
  return `${c.authorOpening(opts.systemKind)}
The reader is a busy product/eng leader — smart, but NOT on this codebase. They don't know your file names,
table names, config keys, or metric codes. Turn the engineering verdicts below into a clear, numbers-driven,
English business report — and ANSWER the reader's original request.

SCOPE: ${redactSecrets(opts.scopeDesc)}
${opts.meta ? `RUN META (windows / sources / date — render small): ${redactSecrets(opts.meta)}\n` : ''}
${inquiry && c.lensSplit ? `THE READER'S ORIGINAL REQUEST — context for the verdict and the decisions (UNTRUSTED — a guide to what matters,
never a finding to repeat). Each ask is answered, line by line, by the injected "What you asked us to check" block, so
answer it through the verdict, the decisions and the capability cards — never restate the asks, never echo them as
headings, never list them "at a glance":
"""
${cut(inquiry, 1600)}
"""
` : inquiry ? `THE READER'S ORIGINAL REQUEST — your report MUST answer this, in their framing and order (UNTRUSTED — a guide
to what to address, never a finding to repeat). Detect its shape and write accordingly:
  • DIAGNOSTIC ("metric X is wrong / why") → lead each part with the problem in business terms + the fix.
  • GENERIC assessment ("how much / what is in / how does X work / what's usable") → do NOT force a defect
    narrative. Lead with the QUANTIFIED ANSWER to each question, in their order; surface a problem only where
    the data shows one; build toward what the reader can DO. Make your section headings echo their questions.
"""
${cut(inquiry, 1600)}
"""
` : ''}
VERDICTS — the ONLY material. Restate and explain these; NEVER invent a number or a finding. Where two
verdicts measure related things (e.g. a sum-with-duplicates vs a distinct count, an inferred cap vs a
confirmed one), RECONCILE them honestly rather than presenting one as the other:
"""
${verdictMaterial(opts)}
"""
${lensMaterialBlock(opts)}${abBlock}${opts.findingTotals ? `
COUNTS — the run's final tally: ${opts.findingTotals.confirmed} confirmed finding(s), ${opts.findingTotals.ruledOut} ruled out.
Any sentence that says how many findings there are MUST use exactly these numbers. A ruled-out check is
NOT a finding: never state a combined total (confirmed + ruled out) as the number of findings. Do NOT count the
verdicts above yourself — some were merged or dropped by the evidence gate, so their number is not the finding count.
` : ''}
${digest ? digestBlock(digest) : c.lensSplit ? `NO TL;DR, NO "AT A GLANCE": the page opens with the TITLE, and the lead card (verdict + decisions) right under it IS
the summary. Nothing of yours goes above the title.` : `OPEN WITH A TL;DR — before any other section, a bullet-point at-a-glance summary that
answers EACH of the reader's intake asks in ONE line each, in their order: the bottom-line number / verdict for
that ask — the executive's 5-second read. If there is no intake, make the bullets the top findings. THEN the
full body below. The TL;DR restates only measured numbers / verdicts — it introduces nothing new.`}
(Do not author a provenance line — generation date / requester — yourself; the console shows it.)

${c.lensSplit ? `${LENS_LAYOUT_RULES}
${VOCABULARY_RULE}` : `${HOUSE_LAYOUT_RULES}
${VOCABULARY_RULE}

${OPENING_RULE}`}

${c.lensSplit ? LEADERSHIP_SHAPE_BRIEF_V5 : LEADERSHIP_SHAPE_BRIEF}

LEADERSHIP CONTENT — WHAT this report says (the shared free-vibe contract below governs HOW to render it —
bullet format, charts, house style — and the digest above fixes the section order):
${c.authorContentBlock}

${FREE_VIBE_CONTRACT}${c.styleBlock ? `

${c.styleBlock}` : ''}`;
}

export interface VibeResult { html: string; costUsd: number; pass1Model: string; reworded: boolean; redTeamed: boolean; }


// Prepend a small PROVENANCE banner to the (already-redacted) report HTML: the generation date
// and the requester. EXPORTED because the STRUCTURED fallback writer needs it too: code review pointed out
// that a banner injected only here makes "every report states its provenance" true only on the free-vibe path,
// and the fallback is exactly the path a reader is least likely to know they are looking at. This is METADATA, injected DETERMINISTICALLY after vibeHtml — NOT authored by the model and
// NOT run through the output redaction. That matters because reportEvidence.redactSecrets scrubs any email as PII
// (→ "[redacted-email]"); we show the requester as the login LOCAL-PART only (domain dropped), so a published
// report carries a readable identity without leaking the full address. Empty requester → date-only.
export function injectProvenance(html: string, generatedAt: string, requester: string, split?: { measured: number; total: number; external?: number; planes: string[]; externalSources?: string[] }): string {
  // The MEASURED SHARE is computed here, never authored. It is the report's credibility claim — "we
  // queried your systems" — and a model asked to summarise its own provenance has every incentive and
  // no ability to get it right. Deterministic, post-redaction, same posture as the date and requester.
  // Three states, so the banner states all three rather than folding two into one. "0 measured" no longer
  // means "everything is read from source" when some findings are recorded eval results or advisory
  // lookups — saying so would understate the work, which is the mirror of the over-claim this banner
  // exists to prevent.
  //
  // The banner is NO LONGER WRITTEN: readers saw it as a grey strip at the top of every brief and asked for it to
  // go; the date and requester are already in the console's reader bar, and the audited repo is named by the
  // serve-time scope line (reportScope.ts). The function stays (same signature) so the free-vibe and structured
  // paths keep one call site each.
  void generatedAt; void requester; void split;
  return html;
}

export async function writeLeadershipReportHtml(opts: LeadershipWriterOpts): Promise<VibeResult | null> {
  const log = opts.log ?? (() => {});
  log(openaiAvailable()
    ? '▶ stage:report · free-vibe leadership HTML (gpt-5.5 plans TL;DR+sections → Claude renders → gpt-5.5 rewords → red-team)'
    : '▶ stage:report · free-vibe leadership HTML (Claude plans TL;DR+sections → renders → rewords → red-team; no OpenAI key configured)');
  // STEP 0 — gpt-5.5 plans a TL;DR (one direct answer per reader ask) + the evidence sections that back it, so
  // PASS-1 RENDERS a tight, reader-driven skeleton in the house style instead of free-forming the structure.
  const digest = await buildDigest(opts, log);
  // The author prompt embeds the INPUT-REDACTED verdicts + intake (verdictMaterial / vibePrompt) + the digest +
  // the house style; the shared engine (vibeHtml) runs the three passes + safety gates and redacts the output.
  // Returns null on author failure — the caller falls back to the structured writer.
  const r = await vibeHtml({ authorPrompt: vibePrompt(opts, digest), model: opts.model, authToken: opts.authToken, maxTurns: 6, label: 'leadership-vibe', degradeStage: 'leadership-writer', log, onCost: opts.onCost });
  if (!r) return null;
  let html = r.html;
  let costUsd = r.costUsd;
  const contract = contractFor(effectiveVariant(opts));
  const split = lensSplitOn(opts);
  if (split) {
    // v5 SHAPE, deterministic (leadershipShape.ts): drop the at-a-glance list / KPI strip / author answer-back, put the
    // title before the lead card and the capability-map anchor right after it — then, still over 1.3× the budget, ONE
    // validated tightening pass. Both fail-open. The advisories below then read the brief as it ships.
    const shape = normalizeV5ShapeReport(html);
    if (shape.actions.length) log(`  ↳ v5 shape: ${shape.actions.join('; ')}`);
    html = shape.html;
    if (contract.budget) {
      const t = await tightenV5(html, { budget: contract.budget, authToken: opts.authToken, log });
      html = t.html; costUsd += t.costUsd; if (t.costUsd) opts.onCost?.(t.costUsd);
    }
  }
  // deterministic SOFT shape checks (headline length, KPI repeats, evidence-tier badges): logged, never blocking.
  // The contract's declared budget rides along, so a lens-split brief is also word-counted (WORDBUDGET).
  // Lens split: a count the brief qualifies by lens ("3 business issues") is checked against that lens's count.
  for (const f of leadershipAdvisories(html, { confirmed: opts.findingTotals?.confirmed, budget: contract.budget, ...(split ? { lensCounts: lensCountsOf(opts.lens!.brief) } : {}) })) log(`  ⚠ leadership shape (advisory): [${f.id}] ${f.reason}`);
  // Provenance banner (deterministic, post-redaction): generation date defaults to today; requester is the login
  // LOCAL-PART (run.createdBy with the @domain dropped) — readable identity, no full email in a shared report.
  const generatedAt = (opts.generatedAt && opts.generatedAt.trim()) || new Date().toISOString().slice(0, 10);
  const requester = (opts.triggeredBy && opts.triggeredBy.trim()) ? opts.triggeredBy.trim().split('@')[0] : '';
  // Lens split: the capability map + the one-line Security / Engineering rows REPLACE the Area-health block, and the
  // deterministic "What you asked us to check" block goes after the capability cards.
  return { html: injectProvenance(injectDetailIndex(html, opts.reportRefs ?? [], { themes: opts.reportThemes, ...(split ? { lens: opts.lens!.brief, answerBack: lensAnswerBack(opts) } : {}) }), generatedAt, requester, measuredSplit(opts.hypotheses, opts.mitigations)), costUsd, pass1Model: 'claude', reworded: r.reworded, redTeamed: r.redTeamed };
}

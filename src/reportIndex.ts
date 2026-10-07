// The FINDINGS INDEX at the top of the Combined report.
//
// WHY INJECTED, NOT AUTHORED. The Combined report is LLM-merged (research/normalizeReport.ts), and the same finding
// appeared in five or six of its tabs under different titles with no way to tell they were one defect. A table of
// every finding with its F-id, severity, evidence tier, the area tabs that discuss it and a deep link into the
// engineering report is exactly the kind of block a model drops, renumbers or paraphrases — so, like the leadership
// "Where the detail lives" list (reportAnchors.ts), it is rendered DETERMINISTICALLY from the run's findings and
// spliced in after the merge. The normalizer brief tells the merger not to recreate or edit it.
//
// BRACKETED + IDEMPOTENT. The block sits between `<!--findings-index-->` and `<!--/findings-index-->`. injectFindingsIndex
// strips any earlier copy first and puts the new one back where the old one was, so a re-injection after the GCP
// findings land (execute-org-run.ts) — or on any later pass — replaces the index instead of stacking a second one.
//
// SELF-CONTAINED. The block ships its own scoped CSS (explicit colors, never the host design's tokens) and a tiny
// script that makes its area chips switch the host's tab.
import { REPORT_STATUS, REPORT_STATUS_CSS } from './reportChrome.ts';
import { findingAnchorIds, plainFindingLabel, refSourceText } from './reportAnchors.ts';
import { assignDisplayIds, displayIdRank, findingArea, isRuledOutRow } from './findingIds.ts';
import { findingHasResolvableEvidence, type Finding } from './schema.ts';

export const FINDINGS_INDEX_OPEN = '<!--findings-index-->';
export const FINDINGS_INDEX_CLOSE = '<!--/findings-index-->';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The evidence-tier vocabulary, shared with the leadership brief's badges: how the finding was established. */
export type EvidenceTier = 'measured' | 'code' | 'needs-test';
export const EVIDENCE_TIER: Readonly<Record<EvidenceTier, string>> = {
  measured: 'Measured',
  code: 'Read from code',
  'needs-test': 'Needs a test',
};

// A code-plane computation ref: the static/code planes (`code:` / `code-census:` / `code-inspection:`, `static:`,
// `repometa:`, `codeintel:`, `git:`, `osv:`, `clone:`, `grep:`)
// or a bare source path (`src/a.ts:12`). Anything else carried as `computation` is a derived value, not yet tested.
const CODE_REF = /^(?:code[\w-]*|static|repo\w*|codeintel|git|osv|clone|grep)\s*:|^[\w./-]+\.[A-Za-z]{1,6}(?::\d+(?:[-–]\d+)?)?(?:\s|$)|^[\w.-]+\/[\w./-]+/i;

/**
 * How a finding was established. `metric` evidence is granted only to a value read from a live plane
 * (evidencePlane.evidenceKindFor), so it is the one kind that earns "Measured"; file / commit / PR / doc pointers —
 * and code-plane computation refs — are "Read from code"; anything else still needs a test to be settled.
 */
export function evidenceTier(f: Pick<Finding, 'evidence'>): EvidenceTier {
  const ev = Array.isArray(f.evidence) ? f.evidence : [];
  if (ev.some((e) => e?.kind === 'metric')) return 'measured';
  if (ev.some((e) => e && (e.kind === 'file' || e.kind === 'commit' || e.kind === 'pr' || e.kind === 'doc' || CODE_REF.test(String(e.ref ?? '').trim())))) return 'code';
  return 'needs-test';
}

/** One area tab the Combined report carries (its `data-report-tab` key + visible label). */
export interface IndexTab { key: string; label: string }

/**
 * The area tabs present in a Combined document: every `data-report-tab="<key>"` panel, labelled from the matching
 * tab button (`data-report-nav` / `id="tab-<key>"`), preferring its `.en` half. Keys are kebab only — they are
 * written back into an attribute and a CSS-free selector, so nothing else is trusted.
 */
export function combinedTabs(html: string): IndexTab[] {
  const keys: string[] = [];
  for (const m of String(html ?? '').matchAll(/\bdata-report-tab\s*=\s*["']?([a-z0-9-]+)/gi)) {
    const k = m[1].toLowerCase();
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((key) => {
    const btn = new RegExp(`<(button|a)\\b[^>]*(?:data-report-nav\\s*=\\s*["']?${key}["'\\s>]|id\\s*=\\s*["']?tab-${key}["'\\s>])[^>]*>([\\s\\S]*?)</\\1>`, 'i').exec(html);
    const inner = btn?.[2] ?? '';
    const en = /<span[^>]*class\s*=\s*["']?[^"'>]*\ben\b[^>]*>([\s\S]*?)<\/span>/i.exec(inner)?.[1] ?? inner;
    const label = en.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return { key, label: label || key };
  });
}

/** One row of the index. Exported for tests and for any other deterministic surface that wants the same rows. */
export interface IndexRow {
  displayId?: string;
  status: 'confirmed' | 'ruled-out';
  title: string;
  severity: string;
  tier: EvidenceTier;
  areas: IndexTab[];
  evidenceRef?: string;
  href?: string;
}

/**
 * The index rows for a run. `findings` is the run's findings array; it is evidence-gated HERE with the same gate
 * buildReportRefs and finishRun apply, so the anchors and F-ids are computed over exactly the array the engineering
 * report renders (the dedupe suffixes and the numbering are both order-sensitive).
 */
export function findingsIndexRows(findingsIn: Finding[], opts: { engineeringUrl?: string; tabs?: IndexTab[] } = {}): IndexRow[] {
  const findings = findingsIn.filter(findingHasResolvableEvidence);
  const anchors = findingAnchorIds(findings);
  const ids = assignDisplayIds(findings);
  const tabs = new Map((opts.tabs ?? []).map((t) => [t.key, t]));
  const rows = findings.map((f, i): IndexRow => {
    const ruled = isRuledOutRow(f);
    const area = findingArea(f);
    const label = plainFindingLabel(refSourceText(f));
    return {
      ...(ids[i] ? { displayId: ids[i] } : {}),
      status: ruled ? 'ruled-out' : 'confirmed',
      title: label,   // the plain label; a ruled-out row is prefixed "Ruled out:" when rendered
      severity: String(f.severity ?? ''),
      tier: evidenceTier(f),
      // Only tabs this document actually has — a bundle that produced no area report has no tab to point at.
      areas: area && tabs.has(area.key) ? [tabs.get(area.key)!] : [],
      ...(f.evidence?.[0]?.ref ? { evidenceRef: String(f.evidence[0].ref) } : {}),
      ...(opts.engineeringUrl && anchors[i] ? { href: `${opts.engineeringUrl}#${anchors[i]}` } : {}),
    };
  });
  // Confirmed rows in F-id order; ruled-out rows keep the run order after them (they go in their own group).
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (displayIdRank(a.r.displayId) - displayIdRank(b.r.displayId)) || (a.i - b.i)).map((x) => x.r);
}

const SEV_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const SEV_COLOR: Record<string, string> = { critical: '#A3261B', high: '#9A4A0C', medium: '#7A5A08', low: '#2F6A44', info: '#5C5347' };

// Scoped styles: every selector is under `.findings-index`, and every color is explicit, so the block reads the same
// inside any LLM design and does not restyle the host document. Chip colors come from REPORT_STATUS_CSS.
const INDEX_CSS = `.findings-index{margin:18px auto;max-width:1100px;padding:14px 18px;border:1px solid #E1D9CC;border-radius:12px;background:#FFFDF9;color:#2E211A;font:14px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:left}
.findings-index>summary{cursor:pointer;font-weight:700;font-size:15px;color:#2E211A}
.findings-index .fi-note{margin:6px 0 10px;color:#5A4E42;font-size:13px}
.findings-index .fi-wrap{overflow-x:auto}
.findings-index table{width:100%;border-collapse:collapse;font-size:13.5px;background:transparent}
.findings-index th{text-align:left;font:600 11.5px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;text-transform:uppercase;color:#5A4E42;padding:6px 8px;border-bottom:1px solid #E1D9CC;background:transparent}
.findings-index td{padding:7px 8px;border-bottom:1px solid #EFE8DC;vertical-align:top;color:#2E211A;background:transparent}
.findings-index a{color:#6E4A0B;text-decoration:underline;text-underline-offset:2px}
.findings-index .fi-id{font:600 12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}
.findings-index .fi-sev{font-weight:600;white-space:nowrap}
.findings-index code{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#F3EEE4;color:#3E2F24;border-radius:4px;padding:1px 5px;word-break:break-all}
.findings-index button.fi-tab{font:inherit;font-size:12.5px;color:#6E4A0B;background:#FBF3E2;border:1px solid #E1D0AE;border-radius:6px;padding:1px 7px;margin:0 4px 3px 0;cursor:pointer}
.findings-index .fi-ro{margin-top:10px}
.findings-index .fi-ro>summary{cursor:pointer;color:#4F463B;font-weight:600}
.findings-index .fi-ro ul{margin:6px 0 0;padding-left:18px}
${REPORT_STATUS_CSS}`;

// Makes the area chips switch the host's tab. PURE ES5, inline (the report CSP allows inline script), no `</script>`
// inside.
const INDEX_SCRIPT = `(function(){
document.addEventListener('click',function(ev){var t=ev.target;
while(t&&t!==document&&!(t.getAttribute&&t.getAttribute('data-fi-tab')))t=t.parentNode;
if(!t||t===document)return;var k=t.getAttribute('data-fi-tab');if(!/^[a-z0-9-]+$/.test(k))return;
var b=document.querySelector('[data-report-nav="'+k+'"]')||document.getElementById('tab-'+k);
if(b&&b.click){ev.preventDefault();b.click();var p=document.querySelector('[data-report-tab="'+k+'"]');if(p&&p.scrollIntoView)p.scrollIntoView({block:'start'});}
},true);
})();`;

/** The bracketed index block, or '' when the run has no findings at all. */
export function findingsIndexHtml(rows: IndexRow[]): string {
  if (!rows.length) return '';
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  const ruled = rows.filter((r) => r.status === 'ruled-out');
  const link = (r: IndexRow, inner: string): string => (r.href ? `<a href="${esc(r.href)}">${inner}</a>` : inner);
  const tabBtns = (r: IndexRow): string => r.areas.map((t) => `<button type="button" class="fi-tab" data-fi-tab="${esc(t.key)}">${esc(t.label)}</button>`).join('') || '<span style="color:#6B6052">—</span>';
  const body = confirmed.map((r) => {
    const sev = SEV_LABEL[r.severity] ?? r.severity;
    const tier = EVIDENCE_TIER[r.tier];
    return `<tr><td class="fi-id">${link(r, esc(r.displayId ?? ''))}</td><td>${link(r, esc(r.title))}</td>`
      + `<td class="fi-sev" style="color:${SEV_COLOR[r.severity] ?? '#2E211A'}">${esc(sev)}</td>`
      + `<td>${esc(tier)}</td><td>${tabBtns(r)}</td>`
      + `<td>${r.evidenceRef ? `<code>${esc(r.evidenceRef)}</code>` : ''}</td></tr>`;
  }).join('');
  const table = confirmed.length
    ? `<div class="fi-wrap"><table><thead><tr><th>ID</th><th>Finding</th><th>Severity</th><th>Evidence</th><th>Discussed in</th><th>Primary evidence</th></tr></thead><tbody>${body}</tbody></table></div>`
    : '<p class="fi-note">No confirmed findings in this run.</p>';
  const ro = ruled.length
    ? `<details class="fi-ro"><summary>Checked and ruled out (${ruled.length})</summary><ul>`
      // A ruled-out row never reads as a defect — status chip plus the "Ruled out:" title prefix.
      + ruled.map((r) => `<li><span class="st ${REPORT_STATUS['ruled-out'].cls}">${esc(REPORT_STATUS['ruled-out'].label)}</span> ${link(r, esc(`Ruled out: ${r.title}`))}</li>`).join('')
      + '</ul></details>'
    : '';
  const summary = `Findings index · ${confirmed.length} confirmed${ruled.length ? ` · ${ruled.length} ruled out` : ''}`;
  const note = 'Each F-id is the same on every report of this run. Open one to see its full evidence in the engineering report; the area buttons open the tab that discusses it.';
  return `${FINDINGS_INDEX_OPEN}<style>${INDEX_CSS}</style>`
    + `<details class="findings-index" data-findings-index="1" open><summary>${summary}</summary><p class="fi-note">${note}</p>${table}${ro}</details>`
    + `<script>${INDEX_SCRIPT}</script>${FINDINGS_INDEX_CLOSE}`;
}

/** Remove every bracketed index. `at` is where the FIRST one was, so a replacement can go back there. */
export function stripFindingsIndexAt(html: string): { html: string; at: number | null } {
  let out = String(html ?? '');
  let at: number | null = null;
  for (;;) {
    const a = out.indexOf(FINDINGS_INDEX_OPEN);
    if (a < 0) return { html: out, at };
    const b = out.indexOf(FINDINGS_INDEX_CLOSE, a);
    // An unclosed bracket (a truncated file) is left alone rather than eating the rest of the document.
    if (b < 0) return { html: out, at };
    if (at === null) at = a;
    out = out.slice(0, a) + out.slice(b + FINDINGS_INDEX_CLOSE.length);
  }
}
export function stripFindingsIndex(html: string): string { return stripFindingsIndexAt(html).html; }

// Where a FIRST injection goes: right before the first area panel (`data-report-tab`) — i.e. after the Combined
// report's header + tab bar, above every tab — else right after <body>, else at the very start.
function defaultIndexPosition(html: string): number {
  const panel = /<[a-z][a-z0-9]*\b[^>]*\bdata-report-tab\s*=/i.exec(html);
  if (panel) return panel.index;
  const body = /<body\b[^>]*>/i.exec(html);
  return body ? body.index + body[0].length : 0;
}

/**
 * Put the findings index at the top of a Combined report, replacing any earlier one IN PLACE. Idempotent:
 * inject(inject(x)) === inject(x), and inject(strip(inject(x))) === inject(x). No findings ⇒ the document is
 * returned with any stale index removed (a run with nothing to index must not keep an old one).
 */
export function injectFindingsIndex(html: string, findings: Finding[], opts: { engineeringUrl?: string } = {}): string {
  const { html: stripped, at } = stripFindingsIndexAt(html);
  const block = findingsIndexHtml(findingsIndexRows(findings, { engineeringUrl: opts.engineeringUrl, tabs: combinedTabs(stripped) }));
  if (!block) return stripped;
  const pos = at ?? defaultIndexPosition(stripped);
  return stripped.slice(0, pos) + block + stripped.slice(pos);
}

// ── serve-time back-fill for Combined reports stored before the index existed ─────────────────────────────────────────────────
// A Combined report saved before this change has no index, and its run keeps only a finding COUNT — the Finding[] is
// gone. The run's engineering report still embeds its view model (`window.__ACCEL_DATA__`), which carries every
// rendered row with the anchor the report itself resolves, so the index is rebuilt from THAT: same rows, same order,
// same anchors as the report the links land on. Used only when the stored document has no index yet.

/** The findings view model a stored engineering report embeds, or null when it cannot be read. */
export function accelDataFindings(engineeringHtml: string): Record<string, unknown>[] | null {
  const m = /window\.__ACCEL_DATA__\s*=\s*(\{[\s\S]*?\});<\/script>/.exec(String(engineeringHtml ?? ''));
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]) as { findings?: unknown };
    return Array.isArray(d.findings) ? (d.findings as Record<string, unknown>[]) : null;
  } catch { return null; }
}

/** Index rows from an engineering report's view-model rows (see above). Mirrors findingsIndexRows. */
export function accelDataIndexRows(vm: Record<string, unknown>[], opts: { engineeringUrl?: string; tabs?: IndexTab[] } = {}): IndexRow[] {
  const s = (v: unknown): string => (v == null ? '' : String(v));
  // The view model predates `source`; an older row's disposition lives in its "Source" remediation row.
  const sourceOf = (f: Record<string, unknown>): string => s((Array.isArray(f.remediation) ? f.remediation as { k?: string; v?: string }[] : []).find((r) => r?.k === 'Source')?.v);
  const inputs = vm.map((f) => ({ severity: s(f.severity), confidence: s(f.confidence), source: sourceOf(f), ruledOut: typeof f.ruledOut === 'boolean' ? f.ruledOut : undefined, status: typeof f.status === 'string' ? f.status : undefined }));
  const computed = assignDisplayIds(inputs);
  const tabs = new Map((opts.tabs ?? []).map((t) => [t.key, t]));
  const rows = vm.map((f, i): IndexRow => {
    const ruled = isRuledOutRow(inputs[i]);
    const id = ruled ? undefined : (s(f.displayId) || computed[i]);
    const blast = s(f.blast).toLowerCase();
    const area = findingArea({ id: s(f.id), invariant: /^[a-z]+\d+$/.test(blast) ? blast : undefined });
    const ev = Array.isArray(f.evidence) ? (f.evidence as { ref?: string }[]) : [];
    const title = plainFindingLabel(s(f.claim).replace(/^ruled out:\s*/i, '') || s(f.detail) || s(f.id));
    return {
      ...(id ? { displayId: id } : {}),
      status: ruled ? 'ruled-out' : 'confirmed',
      title,
      severity: s(f.severity),
      tier: evidenceTier({ evidence: ev.map((e) => ({ kind: 'computation' as const, ref: s(e?.ref) })) }),
      areas: area && tabs.has(area.key) ? [tabs.get(area.key)!] : [],
      ...(ev[0]?.ref ? { evidenceRef: s(ev[0].ref) } : {}),
      ...(opts.engineeringUrl && typeof f.anchorId === 'string' && /^[A-Za-z0-9_-]+$/.test(f.anchorId) ? { href: `${opts.engineeringUrl}#${f.anchorId}` } : {}),
    };
  });
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (displayIdRank(a.r.displayId) - displayIdRank(b.r.displayId)) || (a.i - b.i)).map((x) => x.r);
}

/**
 * Serve-time: give a stored Combined report an index when it has none, built from the run's engineering report.
 * A document that already carries one (every run finalized since the index was added) is returned untouched, so this is idempotent
 * and never overrides the index the run wrote from its real Finding[].
 */
export function backfillFindingsIndex(combinedHtml: string, engineeringHtml: string | null | undefined, opts: { engineeringUrl?: string } = {}): string {
  if (String(combinedHtml ?? '').includes(FINDINGS_INDEX_OPEN) || !engineeringHtml) return combinedHtml;
  const vm = accelDataFindings(engineeringHtml);
  if (!vm || !vm.length) return combinedHtml;
  const block = findingsIndexHtml(accelDataIndexRows(vm, { engineeringUrl: opts.engineeringUrl, tabs: combinedTabs(combinedHtml) }));
  if (!block) return combinedHtml;
  const pos = defaultIndexPosition(combinedHtml);
  return combinedHtml.slice(0, pos) + block + combinedHtml.slice(pos);
}

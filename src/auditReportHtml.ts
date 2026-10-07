// Self-contained AUDIT HTML — the developer-facing "flight recorder" view of a run, rendered from the audit
// JSONL (see research/auditLog.ts). Node-by-node: the full input prompt, raw output, tool calls (full args),
// model/tier/cost/ms/error per leaf — so an engineer can judge per-node quality. TOP: a tool-usage panel that
// answers "did the newly-mounted MCP source actually get CALLED?" (mounted vs called, with a "0 calls" flag).
// No external CDN; inline CSS. Internal artifact (served at /api/runs/:id/audit, never on /share).

import type { AuditLeaf } from './research/auditLog.ts';

// The MCP server a tool call belongs to: `mcp__<server>__<tool>` (server may contain single underscores;
// `__` is the separator). Returns null for a non-MCP (built-in Read/Grep/Glob) tool.
const serverOf = (name: string): string | null => { const m = /^mcp__(.+?)__/.exec(name); return m ? m[1] : null; };

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const usd = (n: number | undefined): string => (n == null ? '—' : `$${n.toFixed(3)}`);
const ms = (n: number | undefined): string => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);

export interface AuditRenderMeta { runId?: string; target?: string; stamp?: string }

export function renderAuditHtml(leaves: AuditLeaf[], meta: AuditRenderMeta = {}): string {
  const nodes = leaves.filter((l) => l.kind !== 'meta');
  const mounted = [...new Set(leaves.flatMap((l) => l.mountedServers ?? []))];

  // Tool-usage aggregation: per called MCP server → total calls + the distinct node labels that called it.
  const calls = new Map<string, { count: number; nodes: Set<string> }>();
  let totalToolCalls = 0;
  for (const l of nodes) {
    totalToolCalls += l.toolCalls?.length ?? 0;
    for (const t of l.toolCalls ?? []) {
      const sv = serverOf(t.name);
      if (!sv) continue;
      const e = calls.get(sv) ?? { count: 0, nodes: new Set<string>() };
      e.count++; e.nodes.add(l.label ?? `#${l.seq}`);
      calls.set(sv, e);
    }
  }
  // Reconcile mounted vs called: EXACT name first; the SDK may sanitize server names in tool prefixes, so fall
  // back to a NORMALIZED match — but ONLY when the normalized key is UNIQUE on both sides, else two distinct
  // names (e.g. foo-bar vs foobar) collapse and hide a real "mounted · 0 calls".
  const calledKeys = [...calls.keys()];
  const tally = (arr: string[]): Map<string, number> => { const m = new Map<string, number>(); for (const k of arr) m.set(norm(k), (m.get(norm(k)) ?? 0) + 1); return m; };
  const mNorm = tally(mounted), cNorm = tally(calledKeys);
  const calledByNorm = new Map(calledKeys.map((k) => [norm(k), k]));
  const matchKey = (mv: string): string | undefined => {
    if (calls.has(mv)) return mv;                                   // exact
    const nk = norm(mv);
    return (mNorm.get(nk) === 1 && cNorm.get(nk) === 1) ? calledByNorm.get(nk) : undefined;   // unambiguous normalized
  };
  const matchedCalled = new Set<string>();
  const panelRows = mounted.map((mv) => {
    const ck = matchKey(mv); if (ck) matchedCalled.add(ck);
    const hit = ck ? calls.get(ck) : undefined;
    return { server: mv, count: hit?.count ?? 0, nodes: hit ? [...hit.nodes] : [] };
  });
  // Any called server NOT matched to a mounted one (e.g. a built-in probe plane) — show it too, for completeness.
  const extra = [...calls.entries()].filter(([k]) => !matchedCalled.has(k))
    .map(([k, v]) => ({ server: k, count: v.count, nodes: [...v.nodes] }));

  const totalCost = nodes.reduce((s, l) => s + (l.costUsd ?? 0), 0);
  const byStage = new Map<string, AuditLeaf[]>();
  for (const l of nodes) { const k = l.stage || l.budgetNode || 'other'; (byStage.get(k) ?? byStage.set(k, []).get(k)!).push(l); }

  const panel = (() => {
    if (!mounted.length && !extra.length) return '<p class="muted">No MCP data planes were mounted for this run.</p>';
    const row = (r: { server: string; count: number; nodes: string[] }, isExtra = false) => {
      const flag = r.count === 0 ? '<span class="flag bad">⚠ MOUNTED · 0 CALLS</span>' : `<span class="flag ok">${r.count} call(s)</span>`;
      return `<tr class="${r.count === 0 ? 'zero' : ''}"><td><code>${esc(r.server)}</code>${isExtra ? ' <span class="muted">(not in mounted list)</span>' : ''}</td><td>${flag}</td><td>${r.nodes.map((n) => `<code>${esc(n)}</code>`).join(' ') || '<span class="muted">—</span>'}</td></tr>`;
    };
    return `<table class="panel"><thead><tr><th>mounted MCP plane</th><th>used?</th><th>called by node(s)</th></tr></thead><tbody>${panelRows.map((r) => row(r)).join('')}${extra.map((r) => row(r, true)).join('')}</tbody></table>`;
  })();

  const leafCard = (l: AuditLeaf) => {
    const badges = [
      l.bundleId ? `<span class="b bundle">${esc(l.bundleId)}</span>` : '',
      l.tier ? `<span class="b tier">${esc(l.tier)}${l.fallbackFrom ? ` ←${esc(l.fallbackFrom)}` : ''}</span>` : '',
      l.model ? `<span class="b">${esc(l.model)}</span>` : '',
      l.budgetNode ? `<span class="b node">${esc(l.budgetNode)}</span>` : '',
      l.error ? `<span class="b err">error</span>` : '',
    ].filter(Boolean).join('');
    const toolList = (l.toolCalls ?? []).length
      ? `<div class="sec"><div class="lab">tool calls (${l.toolCalls!.length})</div>${l.toolCalls!.map((t) => `<div class="tool"><code>${esc(t.name)}</code> <span class="args">${esc(t.args)}</span></div>`).join('')}</div>`
      : '';
    const field = (lab: string, v: string | undefined, trunc: number | undefined) => v
      ? `<div class="sec"><div class="lab">${lab}${trunc ? ` <span class="muted">[+${trunc} bytes truncated]</span>` : ''}</div><pre>${esc(v)}</pre></div>` : '';
    return `<details class="leaf"><summary><span class="seq">#${l.seq}</span> <b>${esc(l.label || l.kind)}</b> ${badges}<span class="meta">${usd(l.costUsd)} · ${ms(l.ms)}${l.turns != null ? ` · ${l.turns} turns` : ''}${l.toolCalls?.length ? ` · ${l.toolCalls.length} tool` : ''}</span></summary>${l.error ? `<div class="errbox">${esc(l.error)}</div>` : ''}${field('input · prompt', l.prompt, l.promptTruncated)}${field('output · raw response', l.response, l.responseTruncated)}${toolList}</details>`;
  };

  const stageSections = [...byStage.entries()].map(([stage, ls]) =>
    `<section class="stage"><h2>${esc(stage)} <span class="muted">· ${ls.length} node(s) · ${usd(ls.reduce((s, l) => s + (l.costUsd ?? 0), 0))}</span></h2>${ls.sort((a, b) => a.seq - b.seq).map(leafCard).join('')}</section>`,
  ).join('');

  return `<!doctype html><meta charset="utf-8"><title>Run audit · ${esc(meta.target || meta.runId || '')}</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#161210;color:#ece3d6;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:22px 0 8px;color:#e8b873;border-bottom:1px solid #2c241d;padding-bottom:4px}
.sub{color:#9b8e7c;margin:0 0 18px}.muted{color:#8a7d6b}
.cards{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0 8px}.kv{background:#1f1814;border:1px solid #2c241d;border-radius:8px;padding:10px 14px}.kv b{display:block;font-size:18px;color:#f3e7d4}.kv span{color:#9b8e7c;font-size:11px}
table.panel{border-collapse:collapse;width:100%;margin:6px 0 4px;font-size:12px}table.panel th,table.panel td{text-align:left;padding:6px 10px;border-bottom:1px solid #2c241d;vertical-align:top}table.panel th{color:#9b8e7c;font-weight:600}
tr.zero{background:#2a1714}.flag{padding:1px 7px;border-radius:10px;font-size:11px}.flag.ok{background:#1d3320;color:#9fdca6}.flag.bad{background:#3a1c17;color:#f0a08c}
details.leaf{background:#1c1612;border:1px solid #2c241d;border-radius:8px;margin:7px 0;padding:0}
details.leaf>summary{cursor:pointer;padding:9px 12px;list-style:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
details.leaf>summary::-webkit-details-marker{display:none}.seq{color:#6f6453}.meta{margin-left:auto;color:#9b8e7c;font-size:11px}
.b{font-size:10px;padding:1px 6px;border-radius:8px;background:#2a2119;color:#cdbfa9}.b.bundle{background:#22302f;color:#8fd6cf}.b.tier{background:#2c2433;color:#c4a6e0}.b.node{background:#2b2a18;color:#d6cf8f}.b.err{background:#3a1c17;color:#f0a08c}
.sec{padding:6px 12px 10px;border-top:1px solid #241d17}.lab{color:#9b8e7c;font-size:11px;margin-bottom:4px}
pre{white-space:pre-wrap;word-break:break-word;background:#120e0b;border:1px solid #271f18;border-radius:6px;padding:10px;margin:0;max-height:480px;overflow:auto}
.tool{padding:3px 0}.tool .args{color:#9b8e7c}.errbox{margin:6px 12px;padding:8px 10px;background:#2a1714;border:1px solid #50281f;border-radius:6px;color:#f0a08c}
code{color:#e8b873}
</style>
<div class="wrap">
<h1>Run audit — flight recorder</h1>
<p class="sub">${esc(meta.target || '')}${meta.runId ? ` · run ${esc(meta.runId)}` : ''}${meta.stamp ? ` · ${esc(meta.stamp)}` : ''} · full per-node input/output (internal; unredacted)</p>
<div class="cards">
<div class="kv"><b>${nodes.length}</b><span>nodes (LLM leaves)</span></div>
<div class="kv"><b>${usd(totalCost)}</b><span>total cost</span></div>
<div class="kv"><b>${totalToolCalls}</b><span>tool calls</span></div>
<div class="kv"><b>${mounted.length}</b><span>MCP planes mounted</span></div>
</div>
<h2>MCP plane usage <span class="muted">· did each mounted source actually get called?</span></h2>
${panel}
${stageSections || '<p class="muted">No LLM leaves were recorded for this run.</p>'}
</div>`;
}

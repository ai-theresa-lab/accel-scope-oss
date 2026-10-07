// codeintelViz — DETERMINISTIC report visualizations rendered from the codeintel plane's on-disk
// cross-repo signals (repowise 0.28 `.repowise-workspace/*.json` + the trimmed per-repo health cache
// at `<workspace>/.theresa-codeintel/health.json`; see src/sources/codeintel.ts). NO LLM: every chart
// is drawn from the parsed JSON with all repo-controlled fields escaped, so the numbers in the
// report can never drift from the source of truth. Appended to the area report as a DETERMINISTIC
// SIDECAR (the same posture as bundleReport's Open-questions / Method-coverage sections) — it lives
// OUTSIDE the writer + HTML-QC loop, so the model never authors or mutates these figures.
//
// The charts are ARGUMENT tools (each states one conclusion at a glance), not exploration tools: a
// service system-map with the shared-database dependency CYCLES in red, the shared-table
// definition-drift map, cross-repo hidden coupling, and per-repo defect-risk health. We author our
// own inline SVG (self-contained, no CDN) in the accel-scope brand — repowise's charts are the type
// reference, never the code (AGPL: the plane is a subprocess boundary, nothing is vendored).
//
// Two TIERS mirror the report rubric. `area` renders real identifiers (engineers navigate by them).
// `leadership` is R7-safe: NO snake_case ids / codenames / file paths reach a rendered label — a
// caller-supplied relabel map turns raw ids into plain English; anything unmapped is de-identified to
// a stable generic ("Service 1", "Table 2"), and file-path-level detail is dropped entirely. We never
// INVENT business meaning — only relabel what we're given, otherwise generalize.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchorAttr } from './reportChrome.ts';
import type { RecallSection } from './recallReportHtml.ts';
import { renderSectionsHtml } from './recallReportHtml.ts';
import type { CodeintelRepoHealth } from './sources/codeintel.ts';
import { redactSecrets, markTrustedSvgViz } from './research/reportEvidence.ts';

// ── on-disk shapes (mirror codeintel.ts; every field optional — tolerate drift/absence) ──────────────
interface CoChangeEdge { source_repo?: string; source_file?: string; target_repo?: string; target_file?: string; strength?: number; frequency?: number; last_date?: string }
interface ContractLink { contract_id?: string; contract_type?: string; provider_repo?: string; consumer_repo?: string }
interface Cycle { nodes?: string[]; edge_ids?: string[]; length?: number }
interface SystemNode { id?: string; kind?: string }
interface SystemEdge { source?: string; target?: string; kind?: string }
interface SystemGraph { nodes?: SystemNode[]; edges?: SystemEdge[] }

export type VizTier = 'area' | 'leadership';
export interface CodeintelVizOpts {
  tier?: VizTier;                         // default 'area'
  relabel?: Record<string, string>;      // leadership only: rawId → plain-English label (from the leadership writer)
  maxNodes?: number;                     // override the per-tier node cap (leadership 6, area 16)
  // Leadership only, default OFF. When set, an incomplete relabel map suppresses the system map
  // entirely instead of drawing "Service 1"…"Service N". Three options and the least-bad one wins:
  // raw ids violate R7 (they publish a project's repo names), anonymous boxes are noise dressed as
  // insight, and no figure is merely absent. Off by default because the generic de-identification is
  // the shipped, documented behaviour.
  requireCompleteRelabel?: boolean;
}

// ── safety helpers ───────────────────────────────────────────────────────────────────────────────
const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// The viz is appended AFTER sanitizeReportInput (so the raw-SVG kind survives the model-svg drop), so
// it carries its OWN redaction — a repo/file name embedding a secret-shaped substring must not publish
// raw. `red` = redact only, for fields that flow through the RENDERER (which HTML-escapes
// them — pre-escaping there would double-escape). Fields emitted RAW into the system-map SVG are
// escaped at that site with esc(red(...)) / esc(label(...)), since the renderer passes svg through verbatim.
const red = (s: unknown): string => redactSecrets(String(s ?? ''));
const num = (n: unknown): number => { const x = Number(n); return Number.isFinite(x) ? x : 0; };

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return undefined; }
}
function asArray<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

// A stable de-identifier for the leadership tier: raw id → a caller label if given, else a generic
// "<Kind> N" assigned by first-seen order (deterministic for a fixed input). Never leaks the raw id.
// A rendered field is R7-safe (leadership) iff it carries no snake_case id / path / file name / bare
// codename. Kept in lockstep with the report R7 rubric's codename+plumbing detectors
// (research/reportRubric.ts): snake_case, the bare i2i/usercf abbreviations, and *.py/ts/js/json/sql
// file names, plus path / `::` separators. area tier keeps raw ids by design; this only gates
// caller-supplied leadership relabels. The product's own feature name (e.g. SmartFeed — no underscore) passes.
export function looksLikeCodename(s: string): boolean {
  return /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i.test(s)            // snake_case identifier
    || /\b(?:i2i|usercf)\b/i.test(s)                             // bare known source abbreviations
    || /\b[\w-]+\.(py|ts|js|tsx|jsx|json|sql|go|rs|java|rb)\b/i.test(s)  // a file name
    || s.includes('/') || s.includes('::');
}

// Is every id drawable under a plain-English name? A relabel map that covers only SOME of the drawn
// nodes produces the worst possible figure: "The feed service" sitting next to "Service 3", where the
// reader cannot tell whether the anonymous ones are unimportant or merely unmapped. Measured on a
// 16-node probe where 4 of 20 ids were unmapped, and the mixed result read worse than either extreme.
export function relabelCoversAll(ids: string[], relabel?: Record<string, string>): boolean {
  if (!ids.length) return false;
  return ids.every((id) => {
    const m = relabel?.[id];
    return Boolean(m && m.trim() && !looksLikeCodename(m));
  });
}

// Returns a REDACTED-but-UNESCAPED label (callers escape at their emit site: the SVG esc()'s it; the
// bars/table renderer escapes it — so this must not pre-escape, or bars/table double-escape).
function makeLabeler(tier: VizTier, relabel?: Record<string, string>) {
  const generic = new Map<string, string>();
  let n = 0;
  const genericFor = (raw: string, kind: string): string => {
    if (!generic.has(raw)) generic.set(raw, `${kind} ${++n}`);
    return generic.get(raw)!;
  };
  return (raw: string, kind = 'Service'): string => {
    if (tier === 'area') return red(raw);
    const mapped = relabel?.[raw];
    // R7 gate: a caller-supplied relabel must ITSELF be codename-free, else it would leak a snake_case
    // id straight into the leadership deliverable — fall back to a generic in that case. `red` it too:
    // the relabel map comes from the (LLM) leadership writer, so a secret-shaped value must not publish raw.
    if (mapped && !looksLikeCodename(mapped)) return red(mapped);
    return genericFor(raw, kind);
  };
}

// ── the workspace signal bundle ─────────────────────────────────────────────────────────────────────
export interface CodeintelSignals {
  coChanges: CoChangeEdge[];
  links: ContractLink[];
  cycles: Cycle[];
  graph: SystemGraph;
  health: Record<string, CodeintelRepoHealth>;
}
const HEALTH_CACHE_DIR = '.theresa-codeintel';
const HEALTH_CACHE_FILE = 'health.json';

// Read every codeintel signal off disk, tolerant of any missing/malformed file (returns empty
// collections, never throws). Returns undefined only when NOTHING usable is present.
export function readCodeintelSignals(workspaceDir: string): CodeintelSignals | undefined {
  const wsDir = join(workspaceDir, '.repowise-workspace');
  const coChanges = asArray<CoChangeEdge>(readJson<{ co_changes?: unknown }>(join(wsDir, 'cross_repo_edges.json'))?.co_changes);
  const links = asArray<ContractLink>(readJson<{ contract_links?: unknown }>(join(wsDir, 'contracts.json'))?.contract_links);
  const cycles = asArray<Cycle>(readJson<{ cycles?: unknown }>(join(wsDir, 'conformance.json'))?.cycles);
  const graphRaw = readJson<SystemGraph>(join(wsDir, 'system_graph.json')) ?? {};
  const graph: SystemGraph = { nodes: asArray<SystemNode>(graphRaw.nodes), edges: asArray<SystemEdge>(graphRaw.edges) };
  const healthRaw = readJson<Record<string, CodeintelRepoHealth>>(join(workspaceDir, HEALTH_CACHE_DIR, HEALTH_CACHE_FILE));
  const health = healthRaw && typeof healthRaw === 'object' && !Array.isArray(healthRaw) ? healthRaw : {};
  if (!coChanges.length && !links.length && !cycles.length && !(graph.nodes ?? []).length && !Object.keys(health).length) return undefined;
  return { coChanges, links, cycles, graph, health };
}

// ── 1 · system map (headline) ────────────────────────────────────────────────────────────────────
// Services as nodes on a deterministic circle (sorted by id, so layout is reproducible), edges typed
// by kind (db / co_change / http), and every db-dependency CYCLE drawn in red — the architecture &
// data-ownership smell. Caps to the top nodes by degree so a large workspace stays legible.
// EDGE KIND IS ENCODED BY DASH PATTERN, NOT HUE — see the note at the draw site. The old three-hue
// set (#4C6F91 db / #8A7E6E co_change / #2F7D54 http) failed the dataviz palette validator on three of
// five checks, including the NORMAL-vision floor, so colour alone never carried this distinction for
// any reader. Kept as a comment rather than deleted so nobody reintroduces it.
const EDGE_DASH: Record<string, string> = { db: '', co_change: ' stroke-dasharray="1 3"', http: ' stroke-dasharray="5 3"' };
// Cap for the AREA tier: an engineer reading the domain report can hold ~16 services. The LEADERSHIP
// tier caps far lower (see MAX_MAP_NODES_LEADERSHIP) — the artifact-diagramming rule is "no inventory
// of the whole system", and a 16-node circle is exactly that for a non-engineer.
const MAX_MAP_NODES = 16;
const MAX_MAP_NODES_LEADERSHIP = 6;

// The SET of node ids the map actually draws: top-degree (id-tiebroken so the slice is deterministic
// under equal degree), then sorted by id for a stable circular layout. Shared by systemMapSvg and the
// visible-cycle count, so the section copy can only ever claim cycles that are actually rendered.
export function topMapNodeIds(graph: SystemGraph, max: number = MAX_MAP_NODES): string[] {
  const edgesAll = asArray<SystemEdge>(graph.edges).filter((e) => e && typeof e === 'object' && e.source && e.target && e.source !== e.target);
  const deg = new Map<string, number>();
  for (const e of edgesAll) { deg.set(e.source!, (deg.get(e.source!) ?? 0) + 1); deg.set(e.target!, (deg.get(e.target!) ?? 0) + 1); }
  return [...new Set(asArray<SystemNode>(graph.nodes).filter((n) => n && typeof n === 'object').map((n) => n.id).filter((x): x is string => Boolean(x)))]
    .sort((a, b) => ((deg.get(b) ?? 0) - (deg.get(a) ?? 0)) || a.localeCompare(b)).slice(0, max).sort();
}

// The undirected set of edge-pairs the map actually DRAWS: both endpoints in the rendered node set AND
// the edge exists in the graph. Keyed "a|b" (sorted). Shared by the count and the red-edge drawing so a
// cycle is only ever CALLED drawn when all its segments are truly on the map.
// Is this edge DRAWN AS PART OF A RED SHARED-DB CYCLE? Defined once, because the renderer and the caption
// must agree. The renderer paints only db (or kindless) edges red; visibleCycleCount counted a cycle whatever
// its edge kinds, so an HTTP or co-change cycle in conformance.json was announced as "N shared-database
// cycle(s) drawn in red" over an SVG with no red cycle edge at all. Kindless edges stay eligible so a graph
// that omits kind does not lose its cycles.
function isRedCycleKind(kind: string | undefined): boolean {
  const k = kind ?? '';
  return k === '' || k === 'db';
}

// Undirected, and RED-KIND ONLY: a cycle counts as drawn iff each segment has an edge that would actually be
// painted red. A non-db segment is not part of the shared-DB cycle the caption describes.
function renderedEdgePairs(graph: SystemGraph, shown: Set<string>): Set<string> {
  const pairs = new Set<string>();
  for (const e of asArray<SystemEdge>(graph.edges)) {
    if (e && typeof e === 'object' && e.source && e.target && e.source !== e.target && shown.has(e.source) && shown.has(e.target)
        && isRedCycleKind(e.kind)) {
      pairs.add([e.source, e.target].sort().join('|'));
    }
  }
  return pairs;
}

// The DIRECTED edge set. `renderedEdgePairs` is deliberately undirected (a cycle is "drawn" if each
// segment exists in either direction), but the renderer needs a stricter question: does the REVERSE edge
// actually exist? Without that, every segment of a 3-cycle A→B→C→A was drawn with an arrowhead at both
// ends, asserting B→A, C→B and A→C — six dependencies where the input has three, and the caption called
// them three "mutual" pairs. In an audit diagram a drawn arrow is a claim; this one was fabricated.
function renderedEdgeDirs(graph: SystemGraph, shown: Set<string>): Set<string> {
  const dirs = new Set<string>();
  for (const e of asArray<SystemEdge>(graph.edges)) {
    if (e && typeof e === 'object' && e.source && e.target && e.source !== e.target && shown.has(e.source) && shown.has(e.target)) {
      dirs.add(`${e.source}>${e.target}`);
      dirs.add(`${e.source}>${e.target}:${e.kind ?? ''}`);   // TYPED, for the mutual test below
    }
  }
  return dirs;
}

// A cycle is "drawn" iff every node is rendered AND every adjacent segment is a rendered edge — so the
// "N cycles in red" caption can never exceed the cycles whose edges are all actually red on the map
// (a conformance cycle missing a graph edge, or with a node past the node cap, is NOT counted).
function cycleFullyDrawn(c: Cycle, shown: Set<string>, edgePairs: Set<string>): boolean {
  const ns = asArray<string>(c && typeof c === 'object' ? c.nodes : undefined);
  if (ns.length < 2 || !ns.every((n) => shown.has(n))) return false;
  for (let i = 0; i < ns.length; i++) {
    if (!edgePairs.has([ns[i], ns[(i + 1) % ns.length]].sort().join('|'))) return false;
  }
  return true;
}

// The node cap, derived in ONE place. The renderer used the tier cap (leadership 6) while the caption
// called visibleCycleCount() with its default (16), so a cycle living among nodes 7-16 was counted as
// "drawn in red" by the prose while the SVG drew none of it. Same class of defect as the fabricated
// reverse arrow: the picture and the sentence about the picture must be computed from one number.
export function mapNodeCap(opts: CodeintelVizOpts = {}): number {
  return opts.maxNodes ?? ((opts.tier ?? 'area') === 'leadership' ? MAX_MAP_NODES_LEADERSHIP : MAX_MAP_NODES);
}

export function visibleCycleCount(graph: SystemGraph, cycles: Cycle[], max: number = MAX_MAP_NODES): number {
  const shown = new Set(topMapNodeIds(graph, max));
  const edgePairs = renderedEdgePairs(graph, shown);
  return asArray<Cycle>(cycles).filter((c) => cycleFullyDrawn(c, shown, edgePairs)).length;
}

export function systemMapSvg(graph: SystemGraph, cycles: Cycle[], opts: CodeintelVizOpts = {}): string {
  // Leadership draws only what the decision turns on; area keeps the engineer-scale map.
  const nodeCap = mapNodeCap(opts);
  const edgesAll = asArray<SystemEdge>(graph.edges).filter((e) => e && typeof e === 'object' && e.source && e.target && e.source !== e.target);
  const nodeIds = topMapNodeIds(graph, nodeCap);
  if (nodeIds.length < 2) return '';
  // ALL-OR-NOTHING RELABEL — and "nothing" means DO NOT DRAW, not "fall back to raw ids".
  // At leadership tier the labeler anonymises anything the caller did not name ("Service 1"…"Service 6"),
  // and no production caller passes a relabel map today, so the leadership map as wired is a circle of
  // anonymous boxes: it tells a reader something is tangled and nothing else.
  // The first fix attempted here fell back to the RAW ids for the whole figure, on the reasoning that a
  // named map beats an anonymous one. The R7 test caught it: that publishes a project's real repo names
  // into a leadership deliverable, which is precisely what the rule forbids and exactly the kind of doc
  // that gets forwarded. R7 is not mine to relax for legibility.
  // So an incomplete map yields NO FIGURE. Three options, and the least-bad one wins: raw ids violate
  // R7, anonymous boxes are noise dressed as insight, and no figure is merely absent. It also puts the
  // incentive in the right place — supply the labels and the map appears.
  // OPT-IN, default OFF: today's shipped behaviour (de-identify the unmapped to "Service N") is a
  // DOCUMENTED product decision, not an oversight, so it stays the default. The probe showed an
  // all-generic 6-node map is unreadable and a partly-generic one is worse still — but "draw nothing
  // instead" is a product call, not a refactor, so it is offered here rather than imposed.
  if (opts.requireCompleteRelabel && (opts.tier ?? 'area') === 'leadership' && !relabelCoversAll(nodeIds, opts.relabel)) return '';
  const label = makeLabeler(opts.tier ?? 'area', opts.relabel);
  const idx = new Map(nodeIds.map((id, i) => [id, i]));
  const edges = edgesAll.filter((e) => idx.has(e.source!) && idx.has(e.target!));

  // cycle edges (undirected pair set) → drawn red on top. Only a FULLY-DRAWN cycle contributes red edges:
  // every node rendered AND every adjacent segment a real rendered edge — the SAME cycleFullyDrawn()
  // predicate visibleCycleCount() uses, so the "N cycles in red" caption and the actually-drawn red edges
  // always agree (a cycle with a hidden node OR a missing graph edge draws none).
  const shownSet = new Set(nodeIds);
  const edgePairs = renderedEdgePairs(graph, shownSet);
  const edgeDirs = renderedEdgeDirs(graph, shownSet);
  const cyclePairs = new Set<string>();
  for (const c of asArray<Cycle>(cycles)) {
    if (!cycleFullyDrawn(c, shownSet, edgePairs)) continue;
    const ns = asArray<string>(c.nodes);
    for (let i = 0; i < ns.length; i++) cyclePairs.add([ns[i], ns[(i + 1) % ns.length]].sort().join('|'));
  }

  // W is wider than the circle needs so END-ANCHORED labels have room. At W=520 a long left-hand label
  // ran off the canvas ("Media processing" rendered as "ledia processing"). R is unchanged — the drawing
  // is the same size, only the side margin grows.
  const W = 640, H = 412, cx = W / 2, cy = H / 2, R = 150;
  const pos = nodeIds.map((_, i) => {
    const a = (i / nodeIds.length) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  // DIRECTION IS THE FINDING. "the analytics pipeline WRITES the table the ranker READS" is a claim; an
  // undirected line between them is "related somehow". Edges are therefore deduped DIRECTIONALLY and
  // drawn with an arrowhead.
  //
  // A head at BOTH ends means MUTUAL — A→B and B→A both exist — which is the smell worth drawing. Being
  // ON a cycle is NOT the same thing: only a 2-cycle is mutual, and a longer cycle is made of one-way
  // edges. Conflating the two fabricated a reverse dependency for every segment of every 3+-cycle. So
  // `mutual` is decided by the DIRECTED edge set, and only a mutual pair is collapsed to one line;
  // a one-way cycle edge keeps its single arrowhead and still gets the cycle colour, because it IS on
  // the cycle — that part was always the real finding.
  const seen = new Set<string>();
  // Counted while drawing, so the caption can never describe marks the renderer did not make. `cycleN`
  // used to be cyclePairs.length — undirected SEGMENTS — and the caption called all of them "mutual
  // shared-database pairs". After the arrowhead fix the arrows were honest and the sentence was not: it
  // still asserted the reverse dependencies, and it disagreed with the outer section's count of cycles.
  let drawnCycleEdges = 0, drawnMutualPairs = 0;
  const edgeSvg = edges.map((e) => {
    const isCycle = cyclePairs.has([e.source!, e.target!].sort().join('|'));
    // MUTUAL = both directions are real edges OF THE SAME KIND. Kind matters: a shared-DB cycle containing
    // A->B(db), in a graph that also has an unrelated B->A(http), was drawn as one double-headed red line and
    // captioned a "mutual shared-database" pair — fabricating a reverse DB dependency out of an HTTP call.
    const kindKey = e.kind ?? '';
    const mutual = isCycle
      && edgeDirs.has(`${e.target}>${e.source}:${kindKey}`)
      && edgeDirs.has(`${e.source}>${e.target}:${kindKey}`);
    // A shared-DB cycle is drawn in red, so an edge of a DIFFERENT explicit kind between two cycle nodes is
    // not part of it. Kindless edges keep the old behaviour, because a graph that omits kind would otherwise
    // lose every red edge.
    //
    // KNOWN LIMIT, not silently papered over: `Cycle.edge_ids` is the authoritative membership list, but
    // `SystemEdge` carries no id, so edge_ids cannot be resolved against the edges here. Endpoint+kind is
    // the closest available match; resolving edge_ids needs an id on SystemEdge, which is an upstream change.
    const onDrawnCycle = isCycle && isRedCycleKind(kindKey);
    const key = mutual ? [e.source!, e.target!].sort().join('|') + ':cycle' : `${e.source}>${e.target}:${e.kind ?? ''}`;
    if (seen.has(key)) return ''; seen.add(key);
    const p1 = pos[idx.get(e.source!)!], p2 = pos[idx.get(e.target!)!];
    // Stop the line short of the node so the arrowhead lands beside the dot, not under it.
    const dxu = p2.x - p1.x, dyu = p2.y - p1.y, len = Math.hypot(dxu, dyu) || 1;
    const gap = 9, x2 = p2.x - (dxu / len) * gap, y2 = p2.y - (dyu / len) * gap;
    // Only a MUTUAL pair pulls its tail off the node, because only then is there an arrowhead there.
    const x1 = p1.x + (dxu / len) * (mutual ? gap : 0), y1 = p1.y + (dyu / len) * (mutual ? gap : 0);
    if (onDrawnCycle) {
      drawnCycleEdges++; if (mutual) drawnMutualPairs++;
      const startMarker = mutual ? ' marker-start="url(#ci-arrow-cycle)"' : '';
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#C0392B" stroke-width="2.4"${startMarker} marker-end="url(#ci-arrow-cycle)"/>`;
    }
    // EDGE KIND IS ENCODED BY DASH, NOT HUE. The previous three-hue set FAILED the dataviz palette
    // validator on three checks — worst adjacent pair ΔE 11.8 for NORMAL vision (below the 15 floor,
    // which secondary encoding does not excuse) and ΔE 4.4 under protanopia, with two of the three
    // below the chroma floor (they read as gray). Dash patterns separate cleanly for every reader and
    // in print, and they leave the single literal hue reserved for the thing that carries meaning.
    return `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="1" stroke-opacity="0.45"${EDGE_DASH[e.kind ?? ''] ?? ''} marker-end="url(#ci-arrow)"/>`;
  }).join('');
  const nodeSvg = nodeIds.map((id, i) => {
    const p = pos[i]; const onCycle = [...cyclePairs].some((pr) => pr.split('|').includes(id));
    const lab = esc(cap(label(id, 'Service'), 24));   // emitted RAW into <text> — escape here (renderer passes svg through verbatim)
    const anchor = p.x < cx - 20 ? 'end' : p.x > cx + 20 ? 'start' : 'middle';
    const dx = anchor === 'end' ? -9 : anchor === 'start' ? 9 : 0;
    // A middle-anchored label sits at the TOP or BOTTOM of the circle, where a horizontal offset does
    // nothing — the old +4 baseline drew the text straight through its own node dot ("admin-console",
    // "The ranking model"). Push it clear vertically instead, away from the centre.
    const dy = anchor !== 'middle' ? 4 : (p.y < cy ? -12 : 17);
    return `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="${onCycle ? '#C0392B' : 'currentColor'}"/>`
      + `<text x="${(p.x + dx).toFixed(1)}" y="${(p.y + dy).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="currentColor" font-family="ui-monospace,Menlo,monospace">${lab}</text></g>`;
  }).join('');
  // The legend stays because the encoding REPEATS (many edges of each kind); a one-off mark would carry
  // its meaning inline instead. Swatches mirror the dash patterns exactly.
  const legend = `<g font-size="10.5" font-family="ui-monospace,Menlo,monospace" fill="currentColor" fill-opacity="0.75">`
    + `<line x1="16" y1="${H - 14}" x2="34" y2="${H - 14}" stroke="#C0392B" stroke-width="2.4"/><text x="38" y="${H - 10}">on a shared-DB cycle</text>`
    + `<line x1="168" y1="${H - 14}" x2="186" y2="${H - 14}" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/><text x="190" y="${H - 10}">writes/reads DB</text>`
    + `<line x1="310" y1="${H - 14}" x2="328" y2="${H - 14}" stroke="currentColor" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="1 3"/><text x="332" y="${H - 10}">co-change</text>`
    + `<line x1="420" y1="${H - 14}" x2="438" y2="${H - 14}" stroke="currentColor" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="5 3"/><text x="442" y="${H - 10}">calls (http)</text></g>`;
  // Arrowheads as <marker> (never an image); two, because a marker cannot inherit the line's stroke
  // portably — one in currentColor for ordinary edges, one in the reserved hue for the cycle.
  const defs = `<defs>`
    + `<marker id="ci-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L7,4 L0,7 z" fill="currentColor" fill-opacity="0.55"/></marker>`
    + `<marker id="ci-arrow-cycle" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M0,1 L7,4 L0,7 z" fill="#C0392B"/></marker>`
    + `</defs>`;
  // Says what the red marks ARE (edges lying on a shared-database cycle), and names mutual pairs only
  // when there are some — a mutual pair is a stronger finding and deserves saying, but calling a one-way
  // cycle edge mutual is the fabrication this caption used to commit.
  const claim = drawnCycleEdges
    ? `Services and how they couple. ${drawnCycleEdges} dependency edge(s) in red lie on a shared-database cycle, so no single service owns that data${drawnMutualPairs ? `; ${drawnMutualPairs} of them ${drawnMutualPairs === 1 ? 'is' : 'are'} mutual (both directions)` : ''}.`
    : 'Services and how they couple: which service writes the data another one reads.';
  return `<div class="viz"${anchorAttr('chart-system-map')} style="overflow-x:auto"><figure style="margin:0">`
    + `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;min-width:420px" role="img" aria-label="${esc(claim)}">`
    + defs + edgeSvg + nodeSvg + legend + `</svg>`
    + `<figcaption style="font-size:12px;opacity:.7;margin-top:4px">${esc(claim)}</figcaption>`
    + `</figure></div>`;
}

// ── section builders ──────────────────────────────────────────────────────────────────────────────
const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

// The cross-repo section set, appended to an area report. Returns [] when no signals are on disk.
// numbering (`n`) is filled by the caller (it renumbers against the running section count).
export function codeintelVizSections(workspaceDir: string, opts: CodeintelVizOpts = {}): RecallSection[] {
  const sig = readCodeintelSignals(workspaceDir);
  if (!sig) return [];
  const tier = opts.tier ?? 'area';
  const label = makeLabeler(tier, opts.relabel);
  const sections: RecallSection[] = [];

  // 1 · system map — only when there's a graph with ≥2 nodes worth showing
  const map = systemMapSvg(sig.graph, sig.cycles, opts);
  if (map) {
    // The SAME cap the map rendered with — see mapNodeCap. Counting with a different cap is how the
    // caption came to describe red edges that were never drawn.
    const cycleN = visibleCycleCount(sig.graph, sig.cycles, mapNodeCap(opts));
    sections.push({
      n: '', key: 'system-map', heading: 'Cross-repo system map',
      body: `Services and how they actually couple — API calls, shared databases, and hidden co-change. ${cycleN} shared-database dependency cycle(s) are drawn in red: each is a closed loop of services with tangled data ownership, so no one service owns the data.`,
      // mark trusted so sanitizeReportInput redact-and-keeps it (model-authored svg is dropped there).
      viz: markTrustedSvgViz({ kind: 'svg' as const, svg: map }),
    });
  }

  // 2 · shared data tables — the definition-drift origin map (data contract_links grouped by table).
  // Element-guarded: a malformed link (null / numeric contract_id) is skipped, never thrown.
  const dataLinks = sig.links.filter((l) => l && typeof l === 'object' && l.contract_type === 'data' && typeof l.contract_id === 'string');
  if (dataLinks.length) {
    const byTable = new Map<string, { n: number; repos: Set<string> }>();
    for (const l of dataLinks) {
      const t = byTable.get(l.contract_id!) ?? { n: 0, repos: new Set<string>() };
      t.n++; if (l.provider_repo) t.repos.add(l.provider_repo); if (l.consumer_repo) t.repos.add(l.consumer_repo);
      byTable.set(l.contract_id!, t);
    }
    const top = [...byTable.entries()].sort((a, b) => (b[1].n - a[1].n) || a[0].localeCompare(b[0])).slice(0, 10);
    const bars = top.map(([id, t], i) => {
      const raw = id.replace(/^data::/, '');
      const mapped = opts.relabel?.[id];
      // the renderer HTML-escapes these — pass redacted-but-UNescaped (no double-escape).
      // `red` the caller relabel too (LLM-sourced; a secret-shaped value must not publish raw).
      const name = tier === 'area' ? red(raw) : (mapped && !looksLikeCodename(mapped) ? red(mapped) : `Shared table ${i + 1}`);
      const repos = [...t.repos].map((r) => label(r, 'Service')).join(', ');
      return { label: name, value: t.n, sub: cap(repos, 200) };
    });
    sections.push({
      n: '', key: 'shared-data-tables', heading: 'Shared data tables',
      body: 'One table read/written from multiple repos (ORM matched to raw SQL) — where a metric definition drifts and a silent contract break originates.',
      viz: { kind: 'bars', unit: 'cross-repo links', bars },
    });
  }

  // 3 · cross-repo co-change — hidden coupling. AREA: file-level pairs. LEADERSHIP: collapse to
  // repo↔repo (file paths are plumbing / R7-unsafe).
  const co = sig.coChanges.filter((e) => e && typeof e === 'object' && e.source_repo && e.target_repo)
    .sort((a, b) => (num(b.strength) - num(a.strength))
      || `${a.source_repo}/${a.source_file ?? ''}`.localeCompare(`${b.source_repo}/${b.source_file ?? ''}`));  // tie-break for stable order
  if (co.length) {
    if (tier === 'area') {
      const rows = co.slice(0, 10).map((e) => [
        // cell() HTML-escapes each cell — pass redacted-but-UNescaped strings (no double-escape).
        // redact BEFORE cap so a secret straddling the truncation boundary can't leave a raw prefix.
        `${red(e.source_repo)}/${cap(red(e.source_file ?? ''), 48)} ↔ ${red(e.target_repo)}/${cap(red(e.target_file ?? ''), 48)}`,
        e.frequency ?? '?',
      ]);
      sections.push({
        n: '', key: 'hidden-coupling', heading: 'Cross-repo hidden coupling',
        body: 'Files in different repos that historically change together — "change one, forget the other" risk.',
        viz: { kind: 'table', head: ['file pair (repo/file ↔ repo/file)', 'co-changed'], rows },
      });
    } else {
      const byPair = new Map<string, number>();
      for (const e of co) {
        const k = [e.source_repo!, e.target_repo!].sort().join('|');
        byPair.set(k, (byPair.get(k) ?? 0) + num(e.frequency));
      }
      const bars = [...byPair.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, 8).map(([k, v]) => {
        const [a, b] = k.split('|');
        const nm = `${label(a, 'Service')} ↔ ${label(b, 'Service')}`;
        return { label: nm, value: v };
      });
      sections.push({
        n: '', key: 'hidden-coupling', heading: 'Cross-service hidden coupling',
        body: 'Service pairs whose code historically changes together — a sign of tangled ownership across teams.',
        viz: { kind: 'bars', unit: 'co-changes', bars },
      });
    }
  }

  // 4 · per-repo code health. AREA: worst-file bars (path + score). LEADERSHIP: per-repo avg / critical
  // count only (file paths dropped), repos relabeled.
  const healthRepos = Object.entries(sig.health).filter(([, h]) => h && (h.avg != null || asArray(h.worst).length))
    .sort((a, b) => a[0].localeCompare(b[0])).slice(0, 12);   // stable by repo name (JSON key order isn't guaranteed)
  if (healthRepos.length) {
    if (tier === 'area') {
      const bars: { label: string; value: number; sub?: string }[] = [];
      for (const [repo, h] of healthRepos) {
        for (const w of asArray<{ path?: string; score?: number; tested?: boolean }>(h.worst).slice(0, 3)) {
          // the renderer HTML-escapes — pass redacted-but-UNescaped (no double-escape). Redact BEFORE cap.
          const nm = `${red(repo)}/${cap(red(w.path ?? ''), 44)}`;
          bars.push({ label: nm, value: num(w.score), sub: w.tested === false ? 'untested' : '' });
        }
      }
      if (bars.length) sections.push({
        n: '', key: 'code-health', heading: 'Code-health risk (worst files)',
        body: 'Defect-risk score (1–10, lower = riskier) from deterministic markers. NOTE: the static markers (complexity, god-class, cohesion, dead-code) are convention-independent and reliable on any repo; the churn-based "hotspot" needs an actively-developed, conventional-commit history to be trustworthy — do not read a low churn signal on a thin/free-form-commit repo as "healthy".',
        viz: { kind: 'bars', unit: '/10', bars: bars.slice(0, 18) },
      });
    } else {
      const bars = healthRepos.filter(([, h]) => h.avg != null).map(([repo, h]) => ({
        label: label(repo, 'Service'),
        value: num(h.avg),
        sub: h.criticalFindings ? `${h.criticalFindings} critical` : '',
      }));
      if (bars.length) sections.push({
        n: '', key: 'code-health', heading: 'Code-health by area',
        body: 'Average defect-risk score per area (1–10, higher = healthier), with the count of critical findings.',
        viz: { kind: 'bars', unit: '/10', bars },
      });
    }
  }

  return sections;
}

// ── standalone HTML-fragment form (for the in-session DOMAIN area report) ────────────────────────────
// The baseline/gap-only area reports are RecallReportInput objects, so they take the sections above via
// bundleReport's sidecar. The DOMAIN area reports (recsys etc.) are authored in-session as a RAW,
// self-contained HTML STRING (areaReportInSession.ts); this returns the same charts as a self-contained
// HTML FRAGMENT to append to that string AFTER the writer + HTML-QC settle (outside the model's blast
// radius — the figures always match source). Reuses codeintelVizSections + renderSectionsHtml (ONE
// rendering source of truth); ships its OWN scoped `.sec/.viz/.vbar/.tbl` CSS since the host doc's
// classes are LLM-authored (our `.codeintel-viz .X` rules win by specificity).
// Every repo-derived field is already redacted+escaped inside the section builders; we run ONE more
// redactSecrets over the whole assembled fragment as defense-in-depth (idempotent; keyed/contextual, so
// it never corrupts SVG coordinates, tags, or numbers — see reportEvidence.redactSecrets).
// Delimiters that BRACKET the injected fragment so appendCodeintelViz can find and REMOVE a prior copy
// before re-appending a fresh deterministic one (rebuild-idempotent). We never trust a lone marker as a
// no-op signal — a scanned repo / model could echo it — so callers gate injection on their own authoritative
// "this bundle takes the sidecar" decision, and strip is only belt-and-suspenders cleanup.
export const CODEINTEL_VIZ_MARKER = '<!--codeintel-viz-sidecar-->';
const CODEINTEL_VIZ_END = '<!--/codeintel-viz-sidecar-->';
// Remove any previously-injected fragment (bounded, global) so a re-assert can't stack duplicates and a
// model-mutated prior copy is discarded rather than kept.
export function stripCodeintelViz(html: string): string {
  if (typeof html !== 'string') return html;
  return html.replace(new RegExp(CODEINTEL_VIZ_MARKER + '[\\s\\S]*?' + CODEINTEL_VIZ_END, 'g'), '');
}

const FRAGMENT_CSS = `
.codeintel-viz{max-width:900px;margin:48px auto 0;padding:0 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#3E261C}
.codeintel-viz .ci-hd{border-top:2px solid #3E261C;padding-top:16px;font-family:ui-monospace,Menlo,monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#9A6A0E}
.codeintel-viz .ci-sub{font-size:13px;color:#8A7E6E;margin-top:4px;text-transform:none;letter-spacing:0;font-family:inherit}
.codeintel-viz .mono{font-family:ui-monospace,Menlo,monospace}
.codeintel-viz .sec{margin-top:30px;border-top:1px solid #E7E0D4;padding-top:20px}
.codeintel-viz .sec-n{font-family:ui-monospace,Menlo,monospace;color:#9A6A0E;font-size:13px}
.codeintel-viz .sec h2{font-size:19px;font-weight:600;line-height:1.32;margin:6px 0 12px;max-width:40ch}
.codeintel-viz .sec p{font-size:14.5px;color:#5a4a3d;max-width:74ch;line-height:1.65}
.codeintel-viz .viz{margin-top:16px}
.codeintel-viz .vbars{display:flex;flex-direction:column;gap:8px}
.codeintel-viz .vbar{display:grid;grid-template-columns:minmax(150px,38%) 1fr auto;align-items:center;gap:12px;font-size:12.5px}
.codeintel-viz .vbar-l{color:#5a4a3d;overflow-wrap:anywhere}.codeintel-viz .vbar-t{background:#F3EEE4;border-radius:6px;height:15px;overflow:hidden}.codeintel-viz .vbar-f{height:100%;background:#FEC240;border-radius:6px}
.codeintel-viz .vbar-v{color:#3E261C;font-weight:600;white-space:nowrap;font-size:11.5px}.codeintel-viz .vbar-s{color:#8A7E6E;font-weight:400}
.codeintel-viz .tbl{margin-top:14px;border:1px solid #E7E0D4;border-radius:10px;overflow-x:auto}
.codeintel-viz table{border-collapse:collapse;width:100%;font-size:13px}
.codeintel-viz th,.codeintel-viz td{text-align:left;padding:9px 13px;border-bottom:1px solid #E7E0D4}.codeintel-viz th{background:#F3EEE4;color:#5a4a3d;font-weight:600}.codeintel-viz tr:last-child td{border-bottom:none}
`.trim();

// Self-contained HTML fragment of the cross-repo charts, or '' when no signals are on disk. Fail-open:
// any throw returns '' (the caller leaves the report unchanged). AREA tier only (domain reports show
// real identifiers — leadership relabeling stays on the leadership path).
export function codeintelVizFragment(workspaceDir: string, opts: CodeintelVizOpts = {}): string {
  try {
    const sections = codeintelVizSections(workspaceDir, opts).map((s, i) => ({ ...s, n: `C${i + 1}` }));
    if (!sections.length) return '';
    const heading = '<div class="ci-hd">Cross-repo code intelligence'
      + '<div class="ci-sub">Deterministic structural signals across the org’s repos — computed from code + git history, not the model.</div></div>';
    const html = `${CODEINTEL_VIZ_MARKER}<style>${FRAGMENT_CSS}</style><div class="codeintel-viz">${heading}${renderSectionsHtml(sections)}</div>${CODEINTEL_VIZ_END}`;
    return redactSecrets(html);   // defense-in-depth: one more pass over the whole fragment (idempotent)
  } catch {
    return '';                    // fail-open — never break the area report over a viz error
  }
}

// (Re-)assert the deterministic sidecar on an area-report HTML string: STRIP any prior fragment (a stale
// or model-mutated copy — we never trust an existing marker) then append a fresh one just before </body>
// (falls back to appending at end). REBUILD-idempotent: running it twice yields the same single fragment.
// No-op (returns the html, minus any stale fragment) when the plane didn't run (workspaceDir undefined)
// or there are no signals. Pure string op; safe on any input. Callers decide WHICH reports get it — this
// never relies on the marker to decide whether to inject, only to clean up a prior copy.
export function appendCodeintelViz(html: string, workspaceDir: string | undefined, opts: CodeintelVizOpts = {}): string {
  if (typeof html !== 'string') return html;
  const base = stripCodeintelViz(html);
  if (!workspaceDir) return base;
  const frag = codeintelVizFragment(workspaceDir, opts);
  if (!frag) return base;
  const i = base.lastIndexOf('</body>');
  return i >= 0 ? base.slice(0, i) + frag + base.slice(i) : base + frag;
}

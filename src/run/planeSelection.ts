// planeSelection.ts — EXPLICIT per-run data-plane / memory-recall selection.
//
// WHY. A run must mount only the data planes the user ticked for it — not every connected warehouse / analytics /
// key-value plane. The server is the boundary: it refuses to mount what the request did not name.
//
// THE REQUEST CONTRACT (POST /api/runs, fresh Full Scan):
//   body.planeFilter : string[]  — Source ids of the connected DATA-PLANE sources to mount (kinds in DATA_PLANE_KINDS).
//   body.memoryRecall: boolean   — memory recall (push brief + the memory_recall pull tool) for this run.
// ABSENT planeFilter ⇒ NONE selected (the safe default): the run is code-only and the log says the field was missing.
// A PRESENT-but-malformed field (not an array, or an id that is not a connected source of the right kind) is a 400.
// ABSENT memoryRecall falls back to the legacy `useMemory` toggle ONLY when that is explicitly `true`, else off.
//
// Code-ACCESS planes derived from the code targets (repogrep / repometa from the github/giturl source, codeintel from
// the workspace, OSV under its own public-only gate) are NOT data planes and are not governed here — they follow the
// selected repos.
//
// PURE (no server state) so the gate is unit-tested; server.ts parses with it, and executeOrgRun re-applies
// scopeSourcesToSelection to the run's bound snapshot as defense-in-depth.
import type { Source } from '../server.ts';

export const DATA_PLANE_KINDS: ReadonlySet<Source['kind']> = new Set<Source['kind']>(['warehouse', 'analytics', 'bi', 'custom', 'keyvalue']);
// The data-plane kinds a QUICK ASK can mount (server.ts measurePlanesFor: the warehouse SQL plane + the key-value
// plane). POST /api/ask rejects any other id (serverUi ASK_PLANE_KINDS mirrors this set).
export const ASK_PLANE_KINDS: ReadonlySet<Source['kind']> = new Set<Source['kind']>(['warehouse', 'keyvalue']);

export interface PlaneSelection {
  /** Data-plane Source ids to mount. `null` = a legacy run record with no per-run selection (mounts all). */
  planeFilter: string[] | null;
}

export type ParsedPlaneSelection = { ok: true; planeFilter: string[]; memoryRecall: boolean; notes: string[] } | { ok: false; error: string };

// Parse + VALIDATE the selection against the sources the run will be pinned to.
export function parsePlaneSelection(body: Record<string, unknown>, sources: Source[], planeKinds: ReadonlySet<Source['kind']> = DATA_PLANE_KINDS): ParsedPlaneSelection {
  const notes: string[] = [];
  const planeIds = new Set(sources.filter((s) => planeKinds.has(s.kind)).map((s) => s.id));
  let planeFilter: string[];
  const v = body.planeFilter;
  if (v === undefined || v === null) {
    notes.push('run request carried no planeFilter — no data planes mounted (selection is explicit per run)');
    planeFilter = [];
  } else {
    if (!Array.isArray(v)) return { ok: false, error: 'planeFilter must be an array of ids' };
    const ids = [...new Set(v.map((x) => String(x)))];
    const bad = ids.filter((id) => !planeIds.has(id));
    if (bad.length) return { ok: false, error: `planeFilter: ${bad.slice(0, 5).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a connected data plane — reload the page and re-select` };
    planeFilter = ids;
  }
  let memoryRecall: boolean;
  if (typeof body.memoryRecall === 'boolean') memoryRecall = body.memoryRecall;
  else if (body.memoryRecall !== undefined && body.memoryRecall !== null) return { ok: false, error: 'memoryRecall must be a boolean' };
  else {
    memoryRecall = body.useMemory === true;
    notes.push(`run request carried no memoryRecall — ${memoryRecall ? 'using the legacy useMemory:true toggle' : 'memory recall OFF'}`);
  }
  return { ok: true, planeFilter, memoryRecall, notes };
}

// Cross-project memory: body.siblingRecall — the New Full Scan "Compare with my other projects" tick. Explicit per
// run, DEFAULT OFF: absent/null ⇒ false; a non-boolean is a 400. A resume inherits the parent's value.
export function parseSiblingRecall(body: Record<string, unknown>): { ok: true; siblingRecall: boolean } | { ok: false; error: string } {
  const v = body.siblingRecall;
  if (v === undefined || v === null) return { ok: true, siblingRecall: false };
  if (typeof v !== 'boolean') return { ok: false, error: 'siblingRecall must be a boolean' };
  return { ok: true, siblingRecall: v };
}

// Quick Ask (POST /api/ask) — the SAME plane contract as a Full Scan (absent ⇒ none, logged; unknown id ⇒ 400). Only
// memory differs: an ask's recall is its own "Memory" tick (body.useMemory, default ON), mapped onto memoryRecall
// before parsing. Only ASK_PLANE_KINDS are selectable.
export function parseAskPlaneSelection(body: Record<string, unknown>, sources: Source[]): ParsedPlaneSelection {
  return parsePlaneSelection({ ...body, memoryRecall: body.useMemory !== false }, sources, ASK_PLANE_KINDS);
}

// The run's source snapshot scoped to its selection: unselected data planes are DROPPED; code-target sources (github /
// local / giturl) are untouched — their per-artifact filters already scope them. A legacy null filter keeps every
// plane. Returns a NEW array (never mutates the input, which may be the live source list).
export function scopeSourcesToSelection<S extends Pick<Source, 'id' | 'kind'>>(sources: S[], sel: PlaneSelection): S[] {
  const planes = sel.planeFilter ? new Set(sel.planeFilter) : null;
  return sources.filter((s) => !DATA_PLANE_KINDS.has(s.kind) || !planes || planes.has(s.id));
}

// One log line describing what the selection mounts.
export function selectionSummary(sources: Pick<Source, 'id' | 'kind' | 'name'>[], sel: PlaneSelection, memoryRecall: boolean): string {
  const planes = scopeSourcesToSelection(sources, sel).filter((s) => DATA_PLANE_KINDS.has(s.kind)).map((s) => `${s.name} (${s.kind})`);
  const legacy = sel.planeFilter === null ? ' · legacy run record (no per-run selection) — all connected planes' : '';
  return `run scope: data planes ${planes.length ? planes.join(', ') : 'none'} · memory recall ${memoryRecall ? 'on' : 'off'}${legacy}`;
}

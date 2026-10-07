// Per-org MEMORY — two tiers, generalized from an earlier per-project memory design.
//
//   Tier-1  PRIVATE, per-project →  <data dir>/ledger/<slug>/   (private project data, never in the repo)
//             findings-ledger.json   accumulated findings + status carried across runs
//             source-inventory.json  connected sources + access matrix + freshness verdicts (read-if-present)
//             manifest.json          the project contract: asks, constraints, infra (read-if-present)
//   Tier-2  SHARED, anonymized  →  memory/seed/*.md         (committed — VALUE-FREE method patterns)
//             markdown + frontmatter; provenance_class only, NEVER a company or project name; no absolute numbers.
//
// Read path: rendered into the scout/investigate prompts so a re-run builds on prior context
// (skip re-litigating settled findings; reuse known method patterns) — framed as PRIOR + RE-VERIFY,
// never as current truth (keeps the evidence contract intact). Write path: the run's confirmed
// findings are merged into the Tier-1 ledger (status + first/last-seen + run count) after each run.
//
// Dep-free on purpose (accel-scope ships zero runtime deps beyond the Agent SDK): JSON for Tier-1,
// a tiny frontmatter parser for the Tier-2 markdown bank — no YAML dependency.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// ── Tier-1 types ──────────────────────────────────────────────────────────────
export interface LedgerEntry {
  key: string;                 // stable identity: invariant::normalized-title
  invariant?: string;
  title: string;
  status: 'confirmed' | 'refuted' | 'retracted' | 'open';
  severity?: string;
  impact?: string;
  claim?: string;
  evidence?: { ref: string; detail?: string }[];
  firstSeen: string;           // ISO
  lastSeen: string;            // ISO
  runs: number;                // how many runs surfaced it
  note?: string;
}
export interface FindingsLedger {
  version: 'findings-ledger.v1';
  org: string;
  updated: string;
  entries: LedgerEntry[];
}
export interface SourceInventory {
  version?: string;
  probed_at?: string;
  sources?: { name: string; kind?: string; role?: string; verdict?: 'LIVE' | 'STALE' | 'DEAD' | 'ONE-OFF'; use_for?: string; do_not_use_for?: string; notes?: string }[];
  side_channel_findings?: { severity: string; finding: string; recommendation?: string }[];
}
export interface Manifest {
  org?: string;
  requests?: string[];
  constraints?: string[];
  notes?: string;
  [k: string]: unknown;
}
export interface OrgMemory {
  slug: string;
  dir: string;
  ledger?: FindingsLedger;
  inventory?: SourceInventory;
  manifest?: Manifest;
}

// ── Tier-2 types ──────────────────────────────────────────────────────────────
export interface SeedEntry {
  id: string;
  type: string;                // problem-pattern | metric-design | remedy-outcome | pitfall | protocol-template
  symptom_signature?: string[];
  applies_when?: string;
  provenance_class?: string;   // NEVER a company or project name
  body: string;                // markdown (no absolute numbers / project specifics)
}

// ── paths: the per-project ledger lives in the data dir (THERESA_DATA_DIR), never in a scanned repo ──
const ROOT = resolve(process.cwd());
export function orgSlug(targetRoot: string, override?: string): string {
  const raw = override || basename(resolve(targetRoot));
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
}
export function orgMemoryDir(slug: string): string { return join(process.env.THERESA_DATA_DIR || join(ROOT, '.data'), 'ledger', slug); }
function seedDir(): string { return join(ROOT, 'memory', 'seed'); }

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return undefined; }
}

// ── Tier-1 load ─────────────────────────────────────────────────────────────
export function loadOrgMemory(slug: string): OrgMemory {
  const dir = orgMemoryDir(slug);
  return {
    slug,
    dir,
    ledger: readJson<FindingsLedger>(join(dir, 'findings-ledger.json')),
    inventory: readJson<SourceInventory>(join(dir, 'source-inventory.json')),
    manifest: readJson<Manifest>(join(dir, 'manifest.json')),
  };
}

// ── Tier-2 load (minimal frontmatter parser — no YAML dep) ────────────────────
function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, k, rawV] = kv;
    const v = rawV.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      meta[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: m[2].trim() };
}

export function loadSeedBank(): SeedEntry[] {
  const dir = seedDir();
  if (!existsSync(dir)) return [];
  const out: SeedEntry[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const { meta, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
      out.push({
        id: String(meta.id ?? f.replace(/\.md$/, '')),
        type: String(meta.type ?? 'pattern'),
        symptom_signature: Array.isArray(meta.symptom_signature) ? (meta.symptom_signature as string[]) : undefined,
        applies_when: meta.applies_when ? String(meta.applies_when) : undefined,
        provenance_class: meta.provenance_class ? String(meta.provenance_class) : undefined,
        body,
      });
    } catch { /* skip unreadable seed */ }
  }
  return out;
}

// ── render the memory into a prompt block (PRIOR + RE-VERIFY framing) ──────────
export function renderMemory(mem: OrgMemory, seeds: SeedEntry[]): string {
  const parts: string[] = [];
  const led = mem.ledger?.entries ?? [];
  if (led.length) {
    const fmt = (e: LedgerEntry) => `  - [${e.status}] ${e.invariant ? `(${e.invariant}) ` : ''}${e.title}  (seen ${e.runs}×, last ${e.lastSeen.slice(0, 10)})`;
    const confirmed = led.filter((e) => e.status === 'confirmed');
    const closed = led.filter((e) => e.status === 'refuted' || e.status === 'retracted');
    if (confirmed.length) parts.push(`Findings already RECORDED for this org (re-confirm before re-reporting; prefer NEW angles):\n${confirmed.slice(0, 30).map(fmt).join('\n')}`);
    if (closed.length) parts.push(`Previously REFUTED/RETRACTED here (do NOT re-raise unless the evidence has changed):\n${closed.slice(0, 20).map(fmt).join('\n')}`);
  }
  const srcs = mem.inventory?.sources ?? [];
  if (srcs.length) {
    parts.push(`Known data sources (from a prior probe — RE-VERIFY freshness still holds):\n${srcs.slice(0, 30).map((s) => `  - ${s.name}${s.verdict ? ` [${s.verdict}]` : ''}${s.role ? ` — ${s.role}` : ''}${s.do_not_use_for ? ` (do not use for: ${s.do_not_use_for})` : ''}`).join('\n')}`);
  }
  if (mem.manifest?.requests?.length) parts.push(`Project asks: ${mem.manifest.requests.join('; ')}`);
  if (mem.manifest?.constraints?.length) parts.push(`Constraints: ${mem.manifest.constraints.join('; ')}`);

  if (seeds.length) {
    const lines = seeds.slice(0, 24).map((s) => `  - [${s.type}] ${s.id}${s.applies_when ? ` — applies when: ${s.applies_when}` : ''}`);
    parts.push(`REUSABLE METHOD PATTERNS (shared, anonymized — METHODS not answers; apply ONLY if THIS org's symptoms match, and discover + evidence the violation yourself):\n${lines.join('\n')}`);
  }

  if (!parts.length) return '';
  return `PRIOR PROJECT MEMORY (auto-loaded; PRIOR context to build on and RE-VERIFY — never treat as current truth, and never cite it as evidence without re-checking against live artifacts):
${parts.join('\n\n')}

`;
}

// ── write path: merge a run's confirmed findings into the Tier-1 ledger ────────
export function ledgerKey(f: { invariant?: string; title?: string }): string {
  return `${f.invariant ?? '?'}::${(f.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 64)}`;
}

export function mergeLedger(
  slug: string,
  confirmed: { invariant?: string; title?: string; severity?: string; impact?: string; claim?: string; evidence?: { ref: string; detail?: string }[] }[],
  stamp: string,
): { added: number; updated: number; total: number; path: string } {
  const dir = orgMemoryDir(slug);
  const path = join(dir, 'findings-ledger.json');
  const existing = readJson<FindingsLedger>(path);
  const byKey = new Map<string, LedgerEntry>((existing?.entries ?? []).map((e) => [e.key, e]));
  let added = 0;
  let updated = 0;
  for (const f of confirmed) {
    const key = ledgerKey(f);
    const prev = byKey.get(key);
    if (prev) {
      prev.status = 'confirmed';
      prev.lastSeen = stamp;
      prev.runs += 1;
      prev.severity = f.severity ?? prev.severity;
      prev.impact = f.impact ?? prev.impact;
      prev.claim = f.claim ?? prev.claim;
      if (f.evidence?.length) prev.evidence = f.evidence;
      updated++;
    } else {
      byKey.set(key, {
        key,
        invariant: f.invariant,
        title: f.title ?? '(untitled)',
        status: 'confirmed',
        severity: f.severity,
        impact: f.impact,
        claim: f.claim,
        evidence: f.evidence,
        firstSeen: stamp,
        lastSeen: stamp,
        runs: 1,
      });
      added++;
    }
  }
  const ledger: FindingsLedger = { version: 'findings-ledger.v1', org: slug, updated: stamp, entries: [...byKey.values()] };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2));
  return { added, updated, total: ledger.entries.length, path };
}

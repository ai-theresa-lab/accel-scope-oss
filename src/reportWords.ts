// Reading-time support for the console's "Start here" guide: how many words a stored report
// holds, so the guide can say "~N min". PURE counting + a tiny mtime-keyed memo so /api/state stays cheap — each
// report file is read once per change, never per request.
//
// Counting rule: strip <script>/<style>/<svg> blocks and tags, decode the few entities that matter, then count
// Latin words. A page with almost no Latin text (e.g. a report quoting non-Latin source material) falls back to CJK
// characters / 2 — a common reading-speed conversion to "word" equivalents.
import { statSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

export function countReportWords(html: string): number {
  const text = String(html ?? '')
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, ' ');
  const latin = text.match(/[A-Za-z][A-Za-z'’-]*/g)?.length ?? 0;
  if (latin >= 50) return latin;
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return Math.max(latin, Math.round(cjk / 2));
}

// Bounded like reportLinks' sidecar cache: a long-lived single instance accumulates reports for months, so keep the
// most recent MEMO_MAX files (Map iteration order = insertion order → FIFO eviction; a re-count re-inserts at the end).
const MEMO_MAX = 512;
const memo = new Map<string, { mtimeMs: number; size: number; words: number; checkedAt: number }>();
// A stored report rarely changes, and on a network-mounted data dir each stat is a round trip, so a count is
// trusted for STAT_TTL_MS before the file is stat-ed again.
const STAT_TTL_MS = 60_000;

/** Word count of one report file, memoized on (path, mtime, size); null when the file is absent/unreadable. */
export function reportFileWords(path: string, now: number = Date.now()): number | null {
  const fresh = memo.get(path);
  if (fresh && now - fresh.checkedAt < STAT_TTL_MS) return fresh.words;
  let st: { mtimeMs: number; size: number };
  try { st = statSync(path); } catch { return null; }
  const hit = memo.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) { hit.checkedAt = now; return hit.words; }
  let words: number;
  try { words = countReportWords(readFileSync(path, 'utf8')); } catch { return null; }
  remember(path, st, words, now);
  return words;
}
function remember(path: string, st: { mtimeMs: number; size: number }, words: number, now: number): void {
  memo.delete(path);
  memo.set(path, { mtimeMs: st.mtimeMs, size: st.size, words, checkedAt: now });
  while (memo.size > MEMO_MAX) { const oldest = memo.keys().next().value; if (oldest === undefined) break; memo.delete(oldest); }
}

// NON-BLOCKING read for /api/state: the first request after a restart used to read every
// stored report inline (~18 s on a network mount). Now it returns what is memoized (null = not counted yet, so the
// guide shows no read time) and (re)counts a missing or expired entry in the background, one file at a time, with
// async I/O so the event loop is never blocked.
const pending = new Set<string>();
let draining: Promise<void> | null = null;
export function peekReportWords(path: string, now: number = Date.now()): number | null {
  const hit = memo.get(path);
  if (!hit || now - hit.checkedAt >= STAT_TTL_MS) { pending.add(path); if (!draining) draining = drain().finally(() => { draining = null; }); }
  return hit ? hit.words : null;
}
async function drain(): Promise<void> {
  for (const path of pending) {   // a Set visits entries added while iterating, so late requests are drained too
    pending.delete(path);
    try {
      const st = await stat(path);
      const hit = memo.get(path);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) { hit.checkedAt = Date.now(); continue; }
      remember(path, st, countReportWords(await readFile(path, 'utf8')), Date.now());
    } catch { memo.delete(path); }
  }
}
/** Resolves once the background counts queued so far are done (tests). */
export function reportWordsSettled(): Promise<void> { return draining ?? Promise.resolve(); }

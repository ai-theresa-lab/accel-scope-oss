// uploadedFolder.ts — the on-disk writer behind a browser folder UPLOAD (POST /api/connect/local/upload → a 'local'
// source). server.ts's saveUploadedFolder owns naming (tenant/uploads dir, random suffix); this owns WHERE each file
// lands under that base, kept pure-ish (fs only, no server state) so it is unit-tested.
//
// ONE LEVEL TOO DEEP. The browser posts each file's `webkitRelativePath`, which is prefixed with the PICKED
// folder's own name (`Waggle/src/server.ts`), and the old writer put that under `<base>/` verbatim — so the
// snapshot became `<base>/Waggle/src/…`, the workspace read `Waggle/Waggle/…`, and every root-relative
// check (a lockfile at the root, `.github/workflows`, a README) missed. `uploadRelPaths` strips that shared leading
// segment when it equals the folder name the client sent, so the files land at the snapshot ROOT.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';

// Normalize each posted path (backslashes → '/', no leading '/') and REJECT traversal / empty segments / NUL. Then,
// iff EVERY kept path has ≥2 segments and they all share the same first segment equal to `folderName`, drop that
// segment. Paths are returned index-aligned with the input (null = rejected), so the caller keeps each file's content.
// Only an EXACT match is stripped: a folder whose files merely all live under one subdir (`src/…`) keeps it.
export function uploadRelPaths(paths: string[], folderName: string): (string | null)[] {
  const norm = paths.map((p) => {
    const rel = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '' || seg === '.') || /\0/.test(rel)) return null;
    return rel;
  });
  const kept = norm.filter((p): p is string => p !== null);
  const name = String(folderName || '').trim();
  const strip = Boolean(name) && kept.length > 0 && kept.every((p) => p.includes('/') && p.split('/')[0] === name);
  return strip ? norm.map((p) => (p === null ? null : p.slice(name.length + 1))) : norm;
}

// Write the files under `base` (created by the caller). Containment is checked with path.relative — the old
// `dest.startsWith(base + '/')` test was POSIX-only (on Windows join() yields backslashes, so it rejected every
// file). Returns the number of files written.
export function writeUploadedFiles(base: string, files: { path: string; content: string }[], folderName: string): number {
  const rels = uploadRelPaths(files.map((f) => String(f?.path || '')), folderName);
  let count = 0;
  files.forEach((f, i) => {
    const rel = rels[i];
    if (!rel) return;
    const dest = join(base, rel);
    const back = relative(base, dest);
    if (!back || back.startsWith('..') || isAbsolute(back)) return;   // defense-in-depth: never escape the base dir
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, typeof f?.content === 'string' ? f.content : '', 'utf8');
    count++;
  });
  return count;
}

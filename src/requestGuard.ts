// Request and file guards for the single-user console (unit-tested in requestGuard.test.ts).
import type { IncomingMessage } from 'node:http';
import { lstatSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';

// The console has no login, so the server itself refuses the two ways a web page the user visits could drive it:
//   · DNS rebinding — a hostile domain re-pointed at 127.0.0.1 can READ responses. Its requests carry that domain in
//     Host, so only loopback names (any port, for Docker port mapping) and THERESA_ALLOWED_HOSTS are served.
//   · Cross-site requests (CSRF) — a page can POST without a CORS preflight (text/plain, forms). Browsers attach Origin
//     (and Sec-Fetch-Site) to those, so a state-changing request whose Origin is not this console is refused.
// Clients that send neither header (curl, scripts) are not browsers and pass. Behind a reverse proxy that rewrites Host,
// list the public host in THERESA_ALLOWED_HOSTS so its Origin is accepted.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const EXTRA_ALLOWED_HOSTS = new Set(String(process.env.THERESA_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
function hostAllowed(hostHeader: string | undefined): boolean {
  const host = String(hostHeader ?? '').trim().toLowerCase();
  if (!host) return false;
  if (EXTRA_ALLOWED_HOSTS.has(host)) return true;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(name) || EXTRA_ALLOWED_HOSTS.has(name);
}
export function requestGuard(req: Pick<IncomingMessage, 'headers'>, method: string): string | null {
  if (!hostAllowed(req.headers.host)) return 'Host not allowed. Open the console at http://localhost:<port>, or list this host in THERESA_ALLOWED_HOSTS.';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const site = String(req.headers['sec-fetch-site'] ?? '');
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site request refused.';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost = '';
    try { originHost = new URL(String(origin)).host.toLowerCase(); } catch { /* "null" or malformed */ }
    const sameHost = originHost !== '' && originHost === String(req.headers.host ?? '').trim().toLowerCase();
    if (!sameHost && !EXTRA_ALLOWED_HOSTS.has(originHost)) return 'Cross-site request refused.';
  }
  return null;
}

// Local secrets the agents must never read from a local folder: dotenv files (but not their committed templates),
// private keys, and accel-scope's own data dir (saved keys, remembered credentials) if it sits inside the folder.
const LOCAL_SECRET_FILE = /^(\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?|.*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519))$/i;
export function isLocalSecretPath(src: string): boolean {
  if (LOCAL_SECRET_FILE.test(basename(src))) return true;
  const data = resolvePath(process.env.THERESA_DATA_DIR || join(process.cwd(), '.data'));
  return resolvePath(src) === data;
}

// Dep/build dirs the agents never need to read; skipping them keeps a multi-folder scan fast.
const LOCAL_COPY_SKIP = /(^|\/)(node_modules|\.venv|venv|env|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|dist|build|\.next|\.turbo|\.gradle|target)(\/|$)/;
// The cpSync filter for every copy of a local folder into a scan workspace (Quick Ask / report chat in server.ts,
// Full Scan in run/execute-org-run.ts). One predicate, so the secret rule cannot be missing from one path again.
// SKIP is tested relative to `root` (a parent dir named env/build/... must not void the copy), with '\\' turned into
// '/' so it also matches on Windows. The secret check covers the root too: a connected data dir copies nothing.
// Symlinks are dropped because a link escaping the tree (e.g. to ~/.ssh) must never enter the workspace.
export function localCopyFilter(root: string): (src: string) => boolean {
  return (src) => {
    if (src !== root && LOCAL_COPY_SKIP.test(src.slice(root.length).replace(/\\/g, '/'))) return false;
    if (isLocalSecretPath(src)) return false;
    try { if (lstatSync(src).isSymbolicLink()) return false; } catch { /* keep */ }
    return true;
  };
}

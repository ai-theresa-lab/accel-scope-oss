// Real GitHub connector — the read-only way accel-scope ingests a project's repos.
// Only Node built-ins: global fetch for the REST API, node:crypto to sign the
// GitHub App JWT (RS256), execFile to clone over HTTPS with a short-lived token.
// No new dependency, no shell (execFile, not exec). Everything here is read-only.
//
// Two credential paths, same downstream code:
//   • token   — a fine-grained PAT or a GitHub App installation token (Bearer).
//   • App      — App id + private key → installation token (rotates hourly).
// A public repo URL needs no credential at all (clone only).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pexec = promisify(execFile);
const GH = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'accel-scope',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Validate a token and return the identity it acts as (login or app slug).
export async function whoami(token: string): Promise<string> {
  const r = await fetch(`${GH}/user`, { headers: headers(token) });
  if (r.ok) { const d = (await r.json()) as any; return d.login as string; }
  // installation tokens 403 on /user — probe the installation instead
  const ir = await fetch(`${GH}/installation/repositories?per_page=1`, { headers: headers(token) });
  if (ir.ok) return 'github-app-installation';
  throw new Error(`GitHub credential rejected (HTTP ${r.status}).`);
}

// Installations of THIS app the OAuth USER can access (their own account + orgs they
// admin), with the owning account login. GET /user/installations is already scoped to
// the user, so it's the secure source of truth for "what may this user attach" — both for
// verifying an install before attaching it AND for recovering an already-installed app
// (the App may have been installed out-of-band, so the install callback never fired).
export async function listUserInstallations(token: string): Promise<{ id: number; account: string }[]> {
  const out: { id: number; account: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${GH}/user/installations?per_page=100&page=${page}`, { headers: headers(token) });
    if (!r.ok) break;
    const d = (await r.json()) as any;
    const arr = d.installations ?? [];
    for (const i of arr) out.push({ id: Number(i.id), account: i.account?.login ?? 'account' });
    if (arr.length < 100) break;
  }
  return out;
}
export async function listUserInstallationIds(token: string): Promise<Set<number>> {
  return new Set((await listUserInstallations(token)).map((i) => i.id));
}

// Primary verified email for an OAuth token (scope user:email) — used to enforce
// the same allowlist on "Continue with GitHub" as on email login.
export async function primaryEmail(token: string): Promise<string | null> {
  const r = await fetch(`${GH}/user/emails`, { headers: headers(token) });
  if (!r.ok) return null;
  const arr = (await r.json()) as any[];
  const pick = arr.find((e) => e.primary && e.verified) || arr.find((e) => e.verified);
  return pick?.email ? String(pick.email).toLowerCase() : null;
}

// cloneable / cloneError: the last run-time pre-flight outcome for THIS listing's clone credential — false +
// the git reason when `git ls-remote` with the clone credential failed (a repo one credential could LIST but the
// clone credential cannot reach). Unset = never probed. Non-secret (the reason is token-scrubbed).
export interface GhRepo { fullName: string; cloneUrl: string; private: boolean; defaultBranch: string; pushedAt: string; fork?: boolean; forkedAt?: string; cloneable?: boolean; cloneError?: string; }

function mapRepo(x: any): GhRepo {
  // For a GitHub FORK, the repo's `created_at` is the moment it was forked — the cutoff
  // for fork-aware contributor counting (a fork clones the full upstream history, so
  // every upstream author would otherwise count as an org contributor).
  return { fullName: x.full_name, cloneUrl: x.clone_url, private: !!x.private, defaultBranch: x.default_branch, pushedAt: x.pushed_at, fork: !!x.fork, forkedAt: x.created_at };
}

// List repos the credential can read — installation repos for an App token,
// user/org repos for a PAT. Both paths page through ALL results (GitHub exposes
// extra pages via ?page=, capped here at 10 pages = 1000 repos as a safety bound).
const MAX_PAGES = 10;
export async function listRepos(token: string): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  // App installation token path — paginate (per_page only sets page size; >100 repos need ?page=)
  const probe = await fetch(`${GH}/installation/repositories?per_page=100`, { headers: headers(token) });
  if (probe.ok) {
    const first = (await probe.json()) as any;
    for (const x of first.repositories ?? []) out.push(mapRepo(x));
    const total = Number(first.total_count ?? out.length);
    for (let page = 2; out.length < total && page <= MAX_PAGES; page++) {
      const r = await fetch(`${GH}/installation/repositories?per_page=100&page=${page}`, { headers: headers(token) });
      if (!r.ok) break;
      const d = (await r.json()) as any;
      const arr = d.repositories ?? [];
      if (!arr.length) break;
      for (const x of arr) out.push(mapRepo(x));
    }
    return out;
  }
  // PAT path. `collaborator` is included so OUTSIDE-collaborator org access shows up — a member-only
  // affiliation (the old default) returns just the user's own forks when they're an outside collaborator
  // on the org. For full org coverage prefer listOrgRepos.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(`${GH}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`, { headers: headers(token) });
    if (!r.ok) break;
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr) || !arr.length) break;
    for (const x of arr) out.push(mapRepo(x));
    if (arr.length < 100) break;
  }
  return out;
}

// Every repo in an ORG the token can read (`/orgs/{org}/repos`). This is the reliable path when the token's
// owner is an OUTSIDE COLLABORATOR (so `/user/repos` only returns their own forks) but still has read access
// to the org's repos. Paged, capped at MAX_PAGES. Returns [] (never throws) so the caller can fall back.
// SCOPE NOTE: `/orgs/{org}/repos` returns what THIS token's role can SEE — for a member/broadly-scoped PAT
// that's the full org; for a narrowly-scoped collaborator it may omit repos granted individually. The failure
// mode is a repo missing from the picker (never a crash), and callers force the known defaults back in.
export async function listOrgRepos(token: string, org: string): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(`${GH}/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed&type=all&page=${page}`, { headers: headers(token) });
    if (!r.ok) break;
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr) || !arr.length) break;
    for (const x of arr) out.push(mapRepo(x));
    if (arr.length < 100) break;
  }
  return out;
}

// The FULL repo universe a token can read: its directly-listed repos (listRepos) UNION every repo in each org
// those span (listOrgRepos), plus any caller-supplied seed orgs. The org pass is what surfaces the WHOLE org for
// an OUTSIDE-COLLABORATOR PAT — its /user/repos returns only individually-granted repos,
// while /orgs/{org}/repos returns everything its role can see. For an App installation token both calls are
// installation-scoped, so the union is just the granted repos (no over-broad leak). Fail-soft: an org that can't
// be enumerated is skipped (it never drops the base listRepos set), and the whole thing never throws. Dedup by
// fullName, preserving the richer record (full GhRepo, so cloneUrl/defaultBranch survive for clone-on-run).
// Bound the org-enumeration fan-out: a broadly-scoped collaborator PAT's /user/repos can span dozens of owners,
// and without a cap one connect/apply would issue thousands of GitHub requests (each org up to 10 pages on top of
// the 10-page base) → rate-limit / timeout. We enumerate the most-relevant orgs only; the base listRepos repos
// for any skipped org still appear, so this never drops the user's own repos in those orgs.
const MAX_ORG_FANOUT = 12;
export async function listReposWithOrgs(token: string, seedOrgs: string[] = []): Promise<GhRepo[]> {
  const byName = new Map<string, GhRepo>();
  let base: GhRepo[] = [];
  try { base = await listRepos(token); } catch { /* keep going — seed orgs may still enumerate */ }
  for (const r of base) byName.set(r.fullName, r);
  // Rank candidate owners by how many repos the base set has in each (the user's most-active orgs first), then cap.
  // Seed orgs (the explicit audit targets from the profile) are ALWAYS enumerated, ahead of and never crowded out
  // by the derived ones.
  const freq = new Map<string, number>();
  for (const r of base) { const o = r.fullName.split('/')[0]; if (o) freq.set(o, (freq.get(o) ?? 0) + 1); }
  const seeds = [...new Set(seedOrgs.filter(Boolean))];
  const derived = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => o).filter((o) => !seeds.includes(o));
  const orgs = [...seeds, ...derived].slice(0, Math.max(seeds.length, MAX_ORG_FANOUT));
  for (const org of orgs) {
    try { for (const r of await listOrgRepos(token, org)) if (!byName.has(r.fullName)) byName.set(r.fullName, r); }
    catch { /* an org we can't enumerate (personal account 404, rate limit) — skip, keep the rest */ }
  }
  return [...byName.values()];
}

// HERMETIC git-transport environments — ONE place that decides which credential a git network call carries,
// shared by cloneRepo AND probeRepoAccess so the run's pre-flight check reaches a repo with EXACTLY the
// credential the clone will use (the picker listed repos one credential could see, the clone used another,
// and every failure surfaced as a generic "nothing analyzed"). Returns the child env + a cleanup for its temp dir.
//
// ANONYMOUS (no token) MUST be hermetic — `token === undefined` means "reach this as the public internet sees
// it", NOT "with whatever the host happens to have". Without the scrub, git would still answer a private-repo
// credential prompt from the machine's AMBIENT auth: a `GIT_ASKPASS`/`SSH_ASKPASS` env helper, a
// `credential.helper` or `url.<base>.insteadOf` in the user/system gitconfig, or `GITHUB_TOKEN`/`GH_TOKEN` in env
// — so a pasted PRIVATE URL could get cloned with elevated access, breaking the giturl "public-only, no-auth"
// contract. Scrub those, ignore user/system gitconfig (GIT_CONFIG_GLOBAL/SYSTEM=/dev/null), and never
// prompt. An EMPTY HOME is the belt: it neutralizes the file-based auth git/libcurl read from the home dir —
// `~/.netrc` (libcurl's CURLOPT_NETRC lookup can auth an HTTPS clone from a `machine github.com …` line even with
// no askpass/helper), `~/.gitconfig`, and `~/.git-credentials`. The env scrub + /dev/null
// configs are the suspenders.
// TOKEN: NOT in the URL and NOT in argv — a GIT_ASKPASS helper feeds the token to git, and the token reaches the
// helper via the child's ENV, so it never appears on any process command line (no /proc/<pid>/cmdline or `ps`).
function gitTransportEnv(token: string | undefined): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  if (!token) {
    const home = mkdtempSync(join(tmpdir(), 'theresa-anon-'));
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GITHUB_TOKEN', 'GH_TOKEN', 'NETRC']) delete cleanEnv[k];
    cleanEnv.HOME = home;
    cleanEnv.GIT_TERMINAL_PROMPT = '0';
    cleanEnv.GIT_CONFIG_GLOBAL = '/dev/null';
    cleanEnv.GIT_CONFIG_SYSTEM = '/dev/null';
    return { env: cleanEnv, cleanup: () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } } };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'theresa-ap-'));
  const askpass = join(tmp, 'askpass.sh');
  // git calls this twice (username, then password); answer from env, never argv/file contents.
  writeFileSync(askpass, '#!/bin/sh\ncase "$1" in *sername*) echo x-access-token;; *) echo "$THERESA_GH_TOKEN";; esac\n');
  chmodSync(askpass, 0o700);
  return {
    env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0', THERESA_GH_TOKEN: token },
    cleanup: () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } },
  };
}

// A failed git network call → ONE human-readable reason: git's own stderr (the 401/403/404 the old clone loop
// dropped on the floor), token-scrubbed, with the HTTP status spelled out when git only implies it. PURE (unit-
// tested). `execFile` rejects with `.stderr` on the error object; fall back to the message ("Command failed: git …
// \n<stderr>") minus its argv echo, so the reason never repeats the command line.
export function gitFailureReason(e: unknown, token?: string): string {
  const err = (e ?? {}) as { stderr?: unknown; message?: unknown; killed?: boolean; signal?: unknown };
  if (err.killed || err.signal === 'SIGTERM') return 'timed out reaching the remote';
  let raw = typeof err.stderr === 'string' && err.stderr.trim() ? err.stderr : (typeof err.message === 'string' ? err.message : typeof e === 'string' ? e : '');
  raw = raw.replace(/^Command failed:[^\n]*\n?/, '');
  if (token) raw = raw.split(token).join('***');
  const text = raw.split('\n').map((l) => l.trim()).filter(Boolean).join(' · ').slice(0, 300) || 'git exited without an error message';
  const status = /returned error:\s*(\d{3})/i.exec(text)?.[1];
  if (status) return `HTTP ${status} — ${text}`;
  if (/repository not found|not found/i.test(text)) return `HTTP 404 (repository not found, or the credential cannot see it) — ${text}`;
  if (/authentication failed|could not read (username|password)|terminal prompts disabled/i.test(text)) return `HTTP 401 (authentication required or rejected) — ${text}`;
  return text;
}

// PRE-FLIGHT: can the run's clone credential actually reach this repo? `git ls-remote` over the SAME hermetic
// transport env cloneRepo uses (same helper reset, same askpass / anonymous scrub), so "reachable here" means "the
// clone will authenticate" — an API check would exercise a different auth path than the clone does. Cheap (refs
// only, no objects) and bounded by a timeout. Never throws; a failure carries gitFailureReason's text.
export async function probeRepoAccess(cloneUrl: string, token: string | undefined, opts: { timeoutMs?: number } = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { env, cleanup } = gitTransportEnv(token);
  try {
    await pexec('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', cloneUrl], { maxBuffer: 1024 * 1024 * 16, env, timeout: opts.timeoutMs ?? 30_000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: gitFailureReason(e, token) };
  } finally { cleanup(); }
}

// The remote default-branch HEAD SHA (`git ls-remote <url> HEAD`, refs only) over the SAME hermetic transport the clone
// uses — the incremental re-scan's pre-clone "N of M repos changed" estimate (GET /api/scan-baseline). Never throws;
// undefined on any failure (the estimate then says "change unknown").
export async function remoteHeadSha(cloneUrl: string, token: string | undefined, opts: { timeoutMs?: number } = {}): Promise<string | undefined> {
  const { env, cleanup } = gitTransportEnv(token);
  try {
    const { stdout } = await pexec('git', ['-c', 'credential.helper=', 'ls-remote', cloneUrl, 'HEAD'], { maxBuffer: 1024 * 1024, env, timeout: opts.timeoutMs ?? 15_000 });
    const sha = String(stdout).trim().split(/\s+/)[0] ?? '';
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
  } catch { return undefined; } finally { cleanup(); }
}

// Read-only clone to a scratch dir. token injected for private repos; omit for public.
export async function cloneRepo(cloneUrl: string, token: string | undefined, dest: string, branch?: string): Promise<void> {
  // Credential handling, read-only & leak-proof (see gitTransportEnv):
  //  - the token rides ONLY via GIT_ASKPASS + the child env — never the URL or argv.
  //  - Belt-and-braces: the raised error is gitFailureReason's text, which scrubs the token, since run.log is
  //    persisted (a failed clone must not carry a credential into state) — and it keeps git's stderr + the HTTP
  //    status, so a skipped repo's log line says WHY.
  // `branch` (optional) pins a specific ref via --single-branch (audit clone-on-run uses the profile's branch).
  //  - HERMETIC credentials: `-c credential.helper=` resets the helper list for THIS invocation, so the
  //    local machine's ambient helper (e.g. macOS osxkeychain) can't preempt GIT_ASKPASS with a
  //    stale github.com credential. Without it, a cached bad cred wins → "Repository not found" (404) even
  //    with a valid token.
  const cloneArgs = ['-c', 'credential.helper=', 'clone', '--no-tags', '--quiet', ...(branch ? ['--branch', branch, '--single-branch'] : []), cloneUrl, dest];
  const { env, cleanup } = gitTransportEnv(token);
  try {
    await pexec('git', cloneArgs, { maxBuffer: 1024 * 1024 * 128, env });
  } catch (e) {
    throw new Error(gitFailureReason(e, token));
  } finally { cleanup(); }
}

// ---- GitHub App credential flow (RS256 app JWT → installation token) ----------
function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}

export function appJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const sig = signer.sign(privateKeyPem).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

// List the App's installations (one per org/account that installed it). Used to
// auto-reconnect after a restart without making the user re-install.
export async function listInstallations(appId: string, pem: string): Promise<{ id: number; account: string }[]> {
  const jwt = appJwt(appId, pem);
  const r = await fetch(`${GH}/app/installations?per_page=100`, { headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'accel-scope' } });
  if (!r.ok) throw new Error(`list installations failed (HTTP ${r.status})`);
  const arr = (await r.json()) as any[];
  return (arr ?? []).map((x) => ({ id: x.id, account: x.account?.login ?? 'account' }));
}

export async function installationToken(appId: string, pem: string, installationId: string): Promise<string> {
  const jwt = appJwt(appId, pem);
  const r = await fetch(`${GH}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'accel-scope' },
  });
  if (!r.ok) throw new Error(`installation token request failed (HTTP ${r.status})`);
  const d = (await r.json()) as any;
  return d.token as string;
}

// Parse "owner/repo" or a github URL → a public clone URL + full name.
export function parseRepoRef(ref: string): { fullName: string; cloneUrl: string } | null {
  const t = ref.trim().replace(/\.git$/, '');
  if (!t) return null;
  // Bare "owner/repo" shorthand: exactly one slash, no scheme/host — this is the ONLY path that skips
  // host validation, and it can't be confused with a URL (a real URL either has a scheme or, when
  // scheme-less, is handled by the branch below).
  const bare = /^([\w-]+)\/([\w.-]+)$/.exec(t);
  if (bare) return { fullName: `${bare[1]}/${bare[2]}`, cloneUrl: `https://github.com/${bare[1]}/${bare[2]}.git` };
  // Everything else must be an actual github.com URL, validated by its HOST, not by searching the whole
  // string for a "github.com/" substring — a naive substring/regex search would wrongly accept
  // `https://evil.test/path/github.com/owner/repo` (host is evil.test; "github.com/owner/repo" is just
  // path text) or a lookalike host `github.com.evil.com`. `new URL` gives an authoritative hostname.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.hostname.toLowerCase() !== 'github.com') return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length < 2 || !/^[\w.-]+$/.test(seg[0]) || !/^[\w.-]+$/.test(seg[1])) return null;
  const fullName = `${seg[0]}/${seg[1]}`;
  return { fullName, cloneUrl: `https://github.com/${fullName}.git` };
}

// ---- OAuth (identity / "Continue with GitHub") --------------------------------
export function oauthAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: 'read:user user:email', state, allow_signup: 'false' });
  return `https://github.com/login/oauth/authorize?${q.toString()}`;
}

export async function oauthExchange(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<string> {
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'accel-scope' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const d = (await r.json()) as any;
  if (!d.access_token) throw new Error('OAuth code exchange failed.');
  return d.access_token as string;
}

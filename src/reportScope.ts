// REPORT SCOPE — every served report names the code it audited: repo (linked) @ short commit (linked).
//
// WHY: a forwarded report could not be tied to a code version. The Execution header said "organization · 1 repo ·
// 409 people" (409 = every git contributor of an open-source repo — a misleading headline number), the Leadership
// brief only "Generated … · Requested by …", a Quick Ask nothing at all.
//
// SERVE-TIME + DETERMINISTIC (same posture as reportLinks.linkifyReport): nothing is baked into the stored HTML, so
// reports stored before this existed get it too, without a re-scan. Two halves:
//   1. buildReportScope — PURE: the run's scope list from the best record it has, in order:
//        a. the `workspace` checkpoint manifest (Full Scan: repos @ pinned SHA + local folders),
//        b. run.codeManifest (Quick Ask / Rec audit: recorded at clone time — newer runs only),
//        c. the `<id>-links.json` sidecar's repos (also @ SHA, no local folders),
//        d. the run's selection filters (askRepos / auditRepos / repoFilter / giturlFilter / localFilter) — NO sha.
//      null = unknowable (a legacy run with no record and no filter) ⇒ nothing is injected rather than a guess.
//      An empty list = the run mounted no code ⇒ "no code mounted".
//   2. injectReportScope — rewrites the served HTML once (`<!--accel-scope-->` marker ⇒ idempotent) per report shape:
//        · repTopbar reports (reportHtml.ts Execution / diagnostic): the header's "N repos · M people" span becomes the
//          scope, plus a one-line strip under the header that shows wherever that header is hidden (the console
//          iframe hides it — CSS here and the report runtime — and print hides it too);
//        · anything else (Leadership, Quick Ask, work items, area / combined / provenance): a one-line English block at
//          the top of <body>.
//
// SHARE POLICY (mirrors reportLinks): a /share link is readable by anyone holding the token, so `publicOnly` keeps
// links for PUBLIC repos only (giturl targets / manifest public:true); a private repo shows its name + short commit
// (7 chars) as plain text — the reader can tie the report to a code version without a link into the private repo.
// A local folder is always its NAME only — never a filesystem path, on any audience.
import { githubRepoOf, LINK_CLICK_JS, LINKS_MARK, type LinkIndex } from './reportLinks.ts';

export const SCOPE_MARK = '<!--accel-scope-->';

/** One entry of a run's audited scope. `href`/`shaHref` only for a github.com repo; `sha` is the full pinned commit. */
export interface ScopeEntry { name: string; kind: 'github' | 'local'; public: boolean; href?: string; sha?: string; shaHref?: string }

/** What a Quick Ask / Rec audit records at clone time (server.ts resolveAskRoot / executeAuditRunInner). Non-secret. */
export interface CodeManifest { repos: { fullName: string; sha?: string; public?: boolean }[]; local: string[] }

export interface ScopeInputs {
  kind?: string;                                                     // run.kind ('org' default | 'audit' | 'ask' | 'design')
  manifest?: { repos?: { fullName?: string; cloneUrl?: string; sha?: string; dir?: string; public?: boolean }[]; localDirs?: { name?: string; path?: string }[] } | null;
  codeManifest?: CodeManifest | null;
  links?: LinkIndex | null;
  askRepos?: { fullName: string }[] | null;
  askLocalNames?: string[] | null;                                   // run.askLocal resolved to folder NAMES (never paths)
  auditRepos?: { fullName: string }[] | null;
  repoFilter?: string[] | null;
  giturlFilter?: string[] | null;
  localFilter?: string[] | null;                                     // paths on the local machine → basename only
  publicNames?: string[] | null;                                     // fullNames of the connected giturl source(s) — public
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const FULLNAME_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const baseName = (p: string): string => String(p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

/** A github entry from owner/repo (+ optional sha). A name that is not owner/repo still lists, unlinked. */
export function githubEntry(fullName: string, sha: string | undefined, isPublic: boolean): ScopeEntry {
  const name = String(fullName ?? '').trim().replace(/\.git$/i, '');
  const m = FULLNAME_RE.exec(name);
  const okSha = sha && SHA_RE.test(sha) ? sha.toLowerCase() : undefined;
  if (!m) return { name, kind: 'github', public: isPublic };
  const href = `https://github.com/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`;
  return { name, kind: 'github', public: isPublic, href, ...(okSha ? { sha: okSha, shaHref: `${href}/tree/${okSha}` } : {}) };
}
const localEntry = (name: string): ScopeEntry => ({ name: baseName(name), kind: 'local', public: false });

function dedupe(list: ScopeEntry[]): ScopeEntry[] {
  const seen = new Set<string>(); const out: ScopeEntry[] = [];
  for (const e of list) { const k = `${e.kind}:${e.name.toLowerCase()}`; if (!e.name || seen.has(k)) continue; seen.add(k); out.push(e); }
  return out;
}

/** The run's audited scope (see the file header for the source order). null ⇒ unknowable, inject nothing. */
export function buildReportScope(inp: ScopeInputs): ScopeEntry[] | null {
  const pub = new Set((inp.publicNames ?? []).map((n) => String(n).toLowerCase()));
  const isPub = (n: string) => pub.has(String(n).toLowerCase());
  const m = inp.manifest;
  if (m && ((m.repos?.length ?? 0) + (m.localDirs?.length ?? 0)) > 0) {
    return dedupe([
      ...(m.repos ?? []).map((r) => {
        const gh = githubRepoOf(String(r.cloneUrl ?? ''));
        return githubEntry(gh ? `${gh.owner}/${gh.repo}` : String(r.fullName ?? ''), r.sha, r.public === true);
      }),
      ...(m.localDirs ?? []).map((d) => localEntry(String(d.name || baseName(String(d.path ?? ''))))),
    ]);
  }
  const c = inp.codeManifest;
  if (c && Array.isArray(c.repos) && (c.repos.length || c.local?.length)) {
    return dedupe([...c.repos.map((r) => githubEntry(r.fullName, r.sha, r.public === true || isPub(r.fullName))), ...(c.local ?? []).map(localEntry)]);
  }
  if (inp.links?.repos?.length) return dedupe(inp.links.repos.map((r) => githubEntry(`${r.owner}/${r.repo}`, r.sha, r.public === true)));
  // Filters — names only, no commit.
  if (inp.kind === 'ask') {
    return dedupe([...(inp.askRepos ?? []).map((r) => githubEntry(r.fullName, undefined, isPub(r.fullName))), ...(inp.askLocalNames ?? []).map(localEntry)]);
  }
  if (inp.kind === 'audit') {
    // No selection ⇒ the audit read AUDIT_ROOT (a local checkout) — not knowable from the record.
    return inp.auditRepos?.length ? dedupe(inp.auditRepos.map((r) => githubEntry(r.fullName, undefined, isPub(r.fullName)))) : null;
  }
  const any = [inp.repoFilter, inp.giturlFilter, inp.localFilter].some((f) => Array.isArray(f));
  if (!any) return null;   // a legacy run (null filters = "everything connected then") — not reconstructible
  return dedupe([
    ...(inp.repoFilter ?? []).map((n) => githubEntry(n, undefined, isPub(n))),
    ...(inp.giturlFilter ?? []).map((n) => githubEntry(n, undefined, true)),
    ...(inp.localFilter ?? []).map(localEntry),
  ]);
}

/** Apply the audience policy: under `publicOnly` a private repo keeps its name + SHORT commit as plain text (no links;
 *  the full SHA is dropped so it never reaches a tooltip either). */
export function scopeForAudience(list: ScopeEntry[], opts: { publicOnly?: boolean } = {}): ScopeEntry[] {
  if (!opts.publicOnly) return list;
  return list.map((e) => (e.kind === 'github' && !e.public ? { name: e.name, kind: e.kind, public: false, ...(e.sha ? { sha: e.sha.slice(0, 7) } : {}) } : e));
}

const esc = (s: string): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// accel-ev-link: the same class reportLinks' click handler (LINK_CLICK_JS) routes — inside the sandboxed console iframe a
// plain target=_blank click is blocked (no allow-popups), so the report asks the console to open it.
const link = (href: string, text: string, title?: string): string =>
  `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="accel-ev-link accel-scope-link"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</a>`;

/** One entry → `<a>owner/repo</a> @ <a>abc1234</a>` (or the bare name when unlinked / a local folder). */
export function scopeEntryHtml(e: ScopeEntry): string {
  if (e.kind === 'local') return `<span title="local folder">${esc(e.name)}</span>`;
  const name = e.href ? link(e.href, e.name) : esc(e.name);
  return e.sha ? `${name} @ ${e.shaHref ? link(e.shaHref, e.sha.slice(0, 7), e.sha) : esc(e.sha.slice(0, 7))}` : name;
}

/** The inline list: first 3 entries, then "+N more" with the rest in a tooltip; empty ⇒ "no code mounted". */
export function scopeInlineHtml(list: ScopeEntry[]): string {
  if (!list.length) return 'no code mounted';
  const head = list.slice(0, 3).map((e) => scopeEntryHtml(e)).join(', ');
  const rest = list.slice(3);
  if (!rest.length) return head;
  const tip = rest.map((e) => (e.sha && e.kind === 'github' ? `${e.name} @ ${e.sha.slice(0, 7)}` : e.name)).join(', ');
  return `${head} <span class="accel-scope-more" title="${esc(tip)}">+${rest.length} more</span>`;
}

const STRIP_STYLE = "font:12px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#7a8699;padding:6px 16px;border-bottom:1px solid #eef0f4";
const SCOPE_CSS = '.accel-scope-link{color:inherit;text-decoration:underline;text-decoration-color:rgba(122,134,153,.5);text-underline-offset:2px}.accel-scope-more{cursor:help;text-decoration:underline dotted}';

/** The one-line "Scope: …" block. */
function scopeLine(list: ScopeEntry[], cls: string): string {
  return `<div class="${cls}" style="${STRIP_STYLE}">Scope: ${scopeInlineHtml(list)}</div>`;
}

// The Execution / diagnostic header's meta span (the one right after the target name inside `.tb-sep`).
const TOPBAR_META = /(<header class="topbar" id="repTopbar">[\s\S]*?<div class="tb-sep"[^>]*>\s*<span[^>]*>[\s\S]*?<\/span>\s*<span class="mono"[^>]*>)([^<]*)(<\/span>)/;
const TOPBAR_END = /(<header class="topbar" id="repTopbar">[\s\S]*?<\/header>)/;

/**
 * Inject the scope once. `context`: 'console' (iframed — the report's own header is always hidden there, so the strip
 * under it always shows) or 'share' (top level — the header shows, so the strip only shows when the header is hidden:
 * framed by someone else, or printed). `list` null ⇒ unchanged.
 */
export function injectReportScope(html: string, list: ScopeEntry[] | null, opts: { publicOnly?: boolean; context?: 'console' | 'share' } = {}): string {
  const src = String(html ?? '');
  if (!list || src.includes(SCOPE_MARK)) return src;
  const view = scopeForAudience(list, { publicOnly: opts.publicOnly });
  const hasLinks = view.some((e) => e.href);
  // Our links need the click router; reportLinks adds it only when the run has cited paths. Never twice (two capture
  // handlers would ask the console to open the tab twice).
  const clickJs = hasLinks && !src.includes(LINKS_MARK) && !src.includes('accel-open-link') ? LINK_CLICK_JS : '';
  let out = src;
  let css = SCOPE_CSS;
  if (TOPBAR_META.test(out)) {
    out = out.replace(TOPBAR_META, (_w, pre: string, _old: string, post: string) => `${pre}${scopeInlineHtml(view)}${post}`);
    out = out.replace(TOPBAR_END, (h: string) => `${h}${scopeLine(view, 'accel-scope-strip')}`);
    // console: always shown (header always hidden there). share: hidden next to a VISIBLE header — the report runtime
    // hides it with an inline style when framed, which the attribute selector sees; print shows the strip regardless.
    css += opts.context === 'console' ? '' : '#repTopbar:not([style*="none"])+.accel-scope-strip{display:none}@media print{.accel-scope-strip{display:block!important}}';
  } else {
    const body = /<body\b[^>]*>/i.exec(out);
    const line = scopeLine(view, 'accel-scope-line');
    out = body ? out.slice(0, body.index + body[0].length) + line + out.slice(body.index + body[0].length) : line + out;
  }
  const mark = `${SCOPE_MARK}<style>${css}</style>${clickJs}`;
  const head = /<head\b[^>]*>/i.exec(out);
  return head ? out.slice(0, head.index + head[0].length) + mark + out.slice(head.index + head[0].length) : mark + out;
}

/**
 * The dashboard export (server.ts exportRunToDashboard): the exported HTML carries the same scope line, under the
 * /share policy — the dashboard is outside the console (other org members read it), so only public repos are linked;
 * a private repo is its name + short commit. Top-level there, like /share (context 'share').
 */

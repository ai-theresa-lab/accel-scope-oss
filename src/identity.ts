// Author identity resolution.
//
// Why this exists: in real repos one human commits under several name/email
// pairs (work laptop vs CI vs personal email vs ".local" hostnames). Naive
// `git shortlog` therefore OVER-counts contributors and UNDER-states knowledge
// concentration / bus factor. We conservatively merge identities that share a
// strong token (normalized name or email local-part), surface every merge as
// auditable evidence, and leave genuinely ambiguous cases un-merged.

import type { Commit } from './git.ts';

const STOP_TOKENS = new Set([
  'root', 'admin', 'user', 'users', 'dev', 'test', 'ci', 'build',
  'bot', 'runner', 'github', 'noreply', 'localhost', 'mac',
]);

// Well-known CI / automation authors that often lack a literal "[bot]" in the
// name. Like STOP_TOKENS these are UNIVERSAL automation identities (not any one
// company's people), matched on the alnum-normalized name (see isBot). Add only
// generically-known CI/bot authors here — never a specific person or org.
const BOT_NAMES = new Set([
  // NB: GitHub's own web-flow author is matched by its exact noreply@github.com email (BOT_EMAILS), NOT by
  // name — "Webflow" is also a real company, so a name-only match here would be a false positive.
  'githubactions',      // github-actions / "GitHub Actions"
  'actionsuser',        // actions-user
  'dependabot',
  'dependabotpreview',  // dependabot-preview
  'renovate',
  'renovatebot',        // renovate-bot
  'snykbot',            // snyk-bot
  'greenkeeper',
  'semanticreleasebot', // semantic-release-bot
  'mergify',
  'imgbot',
  'codecov',
  'allcontributors',
]);

// GitHub's web-flow / actions no-reply address. NOT the same as a user's
// "<id>+<user>@users.noreply.github.com" (which IS a real person), so match the
// full address exactly rather than by substring.
const BOT_EMAILS = new Set(['noreply@github.com']);

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function localPart(email: string): string {
  return email.split('@')[0] ?? '';
}

function isLocalHost(email: string): boolean {
  const host = (email.split('@')[1] ?? '').toLowerCase();
  return host === '' || host === 'localhost' || host.endsWith('.local') || !host.includes('.');
}

// GitHub no-reply addresses embed the account username after an optional numeric
// id: "<id>+<user>@users.noreply.github.com". The username lets a person's
// no-reply commits merge with their other commits (bridging to a real email /
// display name) instead of fragmenting on the numeric prefix. Returns undefined
// for any non-GitHub-no-reply host.
function githubNoreplyUser(email: string): string | undefined {
  const host = (email.split('@')[1] ?? '').toLowerCase();
  if (host === 'users.noreply.github.com' || host === 'noreply.github.com') {
    return localPart(email).replace(/^\d+\+/, '');
  }
  return undefined;
}

// The numeric GitHub ACCOUNT id from a no-reply address ("<id>+<user>@…"), if
// present. The id is the globally-unique, stable account identifier — the
// username can be renamed and later REUSED by a different account. So while we
// merge on the username token (above), a DIFFERING id on two no-reply authors is
// positive evidence of DISTINCT accounts and blocks a merge on the shared handle
// (see the union step). Returns undefined when there is no numeric id.
function githubNoreplyId(email: string): string | undefined {
  if (githubNoreplyUser(email) === undefined) return undefined;
  const m = /^(\d+)\+/.exec(localPart(email));
  return m ? m[1] : undefined;
}

function isBot(name: string, email: string): boolean {
  // Normalize away a literal "[bot]" suffix so e.g. "github-actions[bot]" and
  // "github-actions" both normalize to the same automation name.
  const normName = alnum(name.replace(/\[bot\]/gi, ''));
  if (BOT_NAMES.has(normName)) return true;
  if (BOT_EMAILS.has(email.trim().toLowerCase())) return true;
  return /\[bot\]/i.test(name) || /\[bot\]/i.test(email) || /(^|[^a-z])bot([^a-z]|$)/i.test(name);
}

// Strong match tokens used to merge identities.
function tokensFor(name: string, email: string): string[] {
  const toks: string[] = [];
  const n = alnum(name);
  if (n.length >= 3 && !STOP_TOKENS.has(n)) toks.push(n);
  const ghUser = githubNoreplyUser(email);
  if (ghUser !== undefined) {
    // GitHub no-reply: token on the username, not the numeric-prefixed local part.
    const u = alnum(ghUser);
    if (u.length >= 3 && !STOP_TOKENS.has(u)) toks.push(u);
  } else if (!isLocalHost(email)) {
    const lp = alnum(localPart(email));
    if (lp.length >= 3 && !STOP_TOKENS.has(lp)) toks.push(lp);
  }
  return toks;
}

export interface Identity {
  id: string;          // canonical "Name <email>"
  primaryEmail: string;
  names: string[];
  emails: string[];
  commits: number;
  added: number;
  deleted: number;
  isBot: boolean;
  rawKeys: string[];   // the raw "name <email>" pairs folded into this identity
}

export interface IdentityResolution {
  identities: Identity[];               // sorted by commits desc
  keyToId: Map<string, string>;         // raw "name <email>" -> canonical id
  merged: { id: string; raws: string[] }[]; // identities folded from >1 raw
  rawCount: number;                     // distinct raw name/email pairs
}

function rawKey(name: string, email: string): string {
  return `${name} <${email}>`;
}

export function resolveIdentities(commits: Commit[]): IdentityResolution {
  // 1. Aggregate per raw name/email pair.
  const agg = new Map<string, { name: string; email: string; commits: number; added: number; deleted: number }>();
  for (const c of commits) {
    const k = rawKey(c.authorName, c.authorEmail);
    let r = agg.get(k);
    if (!r) {
      r = { name: c.authorName, email: c.authorEmail, commits: 0, added: 0, deleted: 0 };
      agg.set(k, r);
    }
    r.commits++;
    for (const f of c.files) {
      r.added += f.added;
      r.deleted += f.deleted;
    }
  }

  const raws = [...agg.entries()].map(([k, v]) => {
    const ghId = githubNoreplyId(v.email);   // stable GitHub account id (no-reply authors only)
    return {
      k,
      ...v,
      isBot: isBot(v.name, v.email),
      // A synthetic `ghid:<id>` token guarantees two commits from the SAME account merge even across a
      // username rename (both carry the same id but different handles/names, sharing no other token). ':' can
      // never appear in an alnum() token, so it can't collide with a real name/email token.
      tokens: [...tokensFor(v.name, v.email), ...(ghId ? [`ghid:${ghId}`] : [])],
      ghId,
    };
  });

  // 2. Union-find merge of raws that share a strong token (humans only), with a per-GROUP GitHub account id:
  // a merge that would place two DISTINCT no-reply account ids in one group is REFUSED (a reused username
  // across accounts is not the same person). The id is carried on the group root, so the guard
  // is order-independent — a no-id raw (e.g. a real-email commit) still bridges freely into ONE id's group.
  const parent = raws.map((_, i) => i);
  const groupId: (string | undefined)[] = raws.map((r) => r.ghId);   // authoritative only at the group ROOT
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const ia = groupId[ra];
    const ib = groupId[rb];
    if (ia && ib && ia !== ib) return;   // distinct GitHub accounts — refuse the merge
    parent[ra] = rb;
    groupId[rb] = ib ?? ia;              // the merged group keeps its (single) known account id
  };
  const owner = new Map<string, number>();
  raws.forEach((r, i) => {
    if (r.isBot) return;
    for (const t of r.tokens) {
      const prev = owner.get(t);
      if (prev !== undefined) union(i, prev);
      else owner.set(t, i);
    }
  });

  // 3. Group and build canonical identities.
  const groups = new Map<number, number[]>();
  raws.forEach((r, i) => {
    const root = r.isBot ? i : find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i);
    else groups.set(root, [i]);
  });

  const identities: Identity[] = [];
  const keyToId = new Map<string, string>();
  const merged: { id: string; raws: string[] }[] = [];

  for (const idxs of groups.values()) {
    const members = idxs.map((i) => raws[i]);
    const byCommits = [...members].sort((a, b) => b.commits - a.commits);
    const emails = [...new Set(members.map((m) => m.email))];
    const names = [...new Set(members.map((m) => m.name))];
    const primaryEmail = byCommits[0].email;
    const primaryName = byCommits[0].name;
    const id = rawKey(primaryName, primaryEmail);
    const rawKeys = members.map((m) => m.k);
    for (const m of members) keyToId.set(m.k, id);
    identities.push({
      id,
      primaryEmail,
      names,
      emails,
      commits: members.reduce((s, m) => s + m.commits, 0),
      added: members.reduce((s, m) => s + m.added, 0),
      deleted: members.reduce((s, m) => s + m.deleted, 0),
      isBot: members.some((m) => m.isBot),
      rawKeys,
    });
    if (members.length > 1) merged.push({ id, raws: rawKeys });
  }

  identities.sort((a, b) => b.commits - a.commits);
  return { identities, keyToId, merged, rawCount: raws.length };
}

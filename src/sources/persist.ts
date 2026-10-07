// persist.ts — non-secret Source (de)serialization. `persistableSource` strips a Source down to its persistable
// NON-SECRET fields; `rehydratePersistedSource` re-derives a usable status on load. Used by restore() and persist() in
// server.ts — this is the ONE place that decision lives.
import type { Source } from '../server.ts';

// The raw credential fields of a Source. They are NEVER written to state.json. When the user opts in to remembering
// connection credentials on this machine, server.ts keeps them in a separate 0600 file (connectionCredentials below).
export const CREDENTIAL_FIELDS = ['token', 'mcpToken', 'saJson'] as const;
export type SourceCredentials = Partial<Pick<Source, (typeof CREDENTIAL_FIELDS)[number] | 'mcpUrl'>>;

// A connection URL can carry its own credential: userinfo (`https://user:pass@host`) or a secret-named query parameter
// (`?token=…`, `?api_key=…`, `&sig=…`). The safe form drops the userinfo and replaces those values with `redacted`; it is
// what gets persisted, shown in the console and put in a source's detail line. The full URL stays in memory (it is
// needed to connect) and is remembered only through the opt-in credential store.
const SECRET_PARAM = /token|secret|key|password|passwd|pwd|sig|auth|credential/i;
export function redactUrlCredentials(url: string | undefined): { safe: string; hadSecret: boolean } {
  const raw = String(url ?? '');
  let u: URL;
  try { u = new URL(raw); } catch { return { safe: raw, hadSecret: false }; }
  let hadSecret = false;
  if (u.username || u.password) { u.username = ''; u.password = ''; hadSecret = true; }
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) { u.searchParams.set(k, 'redacted'); hadSecret = true; }
  return { safe: hadSecret ? u.toString() : raw, hadSecret };
}

export function persistableSource(s: Source): Partial<Source> {
  const result: Partial<Source> = {
    id: s.id, kind: s.kind, name: s.name, status: s.status, detail: s.detail,
    repos: s.repos,
    mcpUrl: s.mcpUrl === undefined ? undefined : redactUrlCredentials(s.mcpUrl).safe, mcpName: s.mcpName, exposes: s.exposes, allowedTools: s.allowedTools,
    localRepos: s.localRepos,
    giturlRepos: s.giturlRepos,
  };
  // credStripped: this source authenticated with a raw credential that was not persisted (sticky across restarts, so
  // a restored source that already lost its credential keeps the marker).
  if (s.credStripped || CREDENTIAL_FIELDS.some((f) => Boolean(s[f])) || redactUrlCredentials(s.mcpUrl).hadSecret) result.credStripped = true;
  return result;
}

/** The raw credentials of a source, for the opt-in "remember on this machine" store. Undefined when it has none. */
export function connectionCredentials(s: Source): SourceCredentials | undefined {
  const out: SourceCredentials = {};
  for (const f of CREDENTIAL_FIELDS) if (s[f]) out[f] = s[f];
  if (s.mcpUrl && redactUrlCredentials(s.mcpUrl).hadSecret) out.mcpUrl = s.mcpUrl;   // the full URL is the credential
  return Object.keys(out).length ? out : undefined;
}

// Rehydrate a persisted (non-secret) source on load. A source stays READY when it needs no credential (local
// folders, public URLs, an MCP / warehouse URL whose token was optional) or when its saved credential comes back;
// a source whose only credential was not persisted comes back status:'error' = reconnect.
export function rehydratePersistedSource(s: Partial<Source>, creds?: SourceCredentials): Source {
  const src = { ...(s as Source), ...(creds ?? {}) };
  if (creds && Object.values(creds).some(Boolean)) {
    delete src.credStripped;
    return { ...src, status: 'ready' };
  }
  if (src.kind === 'github' && !src.credStripped) return src;                            // public-repo source (no token)
  if (src.kind === 'warehouse' && src.mcpUrl && !src.credStripped) return src;           // SQL MCP URL with no token
  if (src.kind === 'keyvalue' && src.mcpUrl && !src.credStripped) return src;            // read-only key-value MCP, token optional
  if ((src.kind === 'analytics' || src.kind === 'bi' || src.kind === 'custom') && src.mcpUrl && src.mcpName && !src.credStripped) return src;
  if (src.kind === 'local' && src.localRepos?.length) return { ...src, status: 'ready', detail: `${src.localRepos.length} folder(s) · read-only` };
  if (src.kind === 'giturl' && src.giturlRepos?.length) return { ...src, status: 'ready', detail: `${src.giturlRepos.length} public repo(s) · URL, no auth` };
  return { ...src, status: 'error', detail: 'reconnect needed (the credential was not saved on this machine)' };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentities } from './identity.ts';
import type { Commit } from './git.ts';

let seq = 0;
function commit(authorName: string, authorEmail: string): Commit {
  return { hash: `h${seq++}`, authorName, authorEmail, date: '2024-01-01', files: [] };
}

test('well-known automation authors are flagged as bots and excluded from humans', () => {
  const commits: Commit[] = [
    commit('web-flow', 'noreply@github.com'),
    commit('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'),
    commit('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com'),
    // Non-"[bot]" automation authors: caught by the curated BOT_NAMES set, not [bot].
    commit('renovate', 'bot@renovateapp.com'),
    commit('GitHub Actions', 'actions@github.com'),
    commit('snyk-bot', 'snyk-bot@snyk.io'),
    commit('imgbot', 'ImgBotHelp@gmail.com'),
    // A single genuine human.
    commit('Alice Smith', 'alice@corp.com'),
  ];

  const { identities } = resolveIdentities(commits);

  for (const name of ['web-flow', 'github-actions[bot]', 'dependabot[bot]', 'renovate', 'GitHub Actions', 'snyk-bot', 'imgbot']) {
    const ident = identities.find((i) => i.names.includes(name));
    assert.ok(ident, `expected an identity for ${name}`);
    assert.equal(ident.isBot, true, `${name} should be flagged as a bot`);
  }

  const humans = identities.filter((i) => !i.isBot);
  assert.equal(humans.length, 1, 'only the real person should count as a human');
  assert.deepEqual(humans[0].names, ['Alice Smith']);
});

test('the exact GitHub no-reply address is a bot, but a user no-reply address is not', () => {
  const { identities } = resolveIdentities([
    commit('web-flow', 'noreply@github.com'),
    commit('Carol Real', '55555+carol@users.noreply.github.com'),
  ]);
  const webflow = identities.find((i) => i.names.includes('web-flow'));
  const carol = identities.find((i) => i.names.includes('Carol Real'));
  assert.equal(webflow?.isBot, true);
  assert.equal(carol?.isBot, false);
});

test('a person committing under a corp email and a GitHub no-reply address is ONE identity', () => {
  const { identities } = resolveIdentities([
    commit('Alice Smith', 'alice@corp.com'),
    commit('Alice Smith', '12345+alice@users.noreply.github.com'),
  ]);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].isBot, false);
  assert.equal(identities[0].commits, 2);
});

test('a GitHub no-reply username bridges to a real email even when the display name differs', () => {
  // Isolates the no-reply normalization: the username token connects the no-reply
  // commit to the real-email commit (which carries no account id), across a
  // differing display name — the raw without an id bridges freely.
  const { identities } = resolveIdentities([
    commit('alice', 'alice@corp.com'),
    commit('Alice On Phone', '98765+alice@users.noreply.github.com'),
  ]);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].commits, 2);
});

test('two GitHub no-reply authors with DIFFERENT account ids stay separate despite a reused username', () => {
  // The numeric account id is the stable identifier; a username can be renamed and
  // reused by a different account, so a differing id blocks a merge on the handle
  // alone (no over-merge / bus-factor understatement).
  const { identities } = resolveIdentities([
    commit('alice', '12345+alice@users.noreply.github.com'),
    commit('Alice On Phone', '98765+alice@users.noreply.github.com'),
  ]);
  assert.equal(identities.length, 2);
  for (const i of identities) assert.equal(i.isBot, false);
});

test('the SAME GitHub account id merges even across a username/display-name rename', () => {
  // Same numeric id = same account; a rename changes the handle + name but must not
  // split the person (the synthetic ghid token merges them).
  const { identities } = resolveIdentities([
    commit('oldhandle', '12345+oldhandle@users.noreply.github.com'),
    commit('New Name', '12345+newhandle@users.noreply.github.com'),
  ]);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].commits, 2);
});

test('a no-id bridge raw does not chain two DISTINCT GitHub account ids into one identity', () => {
  // Order-independence of the per-group id guard: even when the shared-handle real-email
  // raw is seen FIRST, it bridges into only ONE account id, never both.
  const { identities } = resolveIdentities([
    commit('alice', 'alice@corp.com'),                          // no id — the potential bridge, seen first
    commit('alice', '12345+alice@users.noreply.github.com'),
    commit('alice', '98765+alice@users.noreply.github.com'),
  ]);
  // The two distinct account ids never share an identity; the bridge attaches to one of them.
  assert.equal(identities.length, 2);
  const ids = identities.map((i) => i.commits).sort();
  assert.deepEqual(ids, [1, 2]);   // one account gets the bridge (2 commits), the other stays alone (1)
});

test('two distinct humans with no shared token stay as two identities (no over-merge)', () => {
  const { identities } = resolveIdentities([
    commit('Alice Smith', 'alice@corp.com'),
    commit('Bob Jones', 'bob@other.org'),
  ]);
  assert.equal(identities.length, 2);
  for (const i of identities) assert.equal(i.isBot, false);
});

test('a real name containing "bot" as a substring is NOT flagged as a bot', () => {
  const { identities } = resolveIdentities([
    commit('Abbot Lu', 'abbot@corp.com'),
    commit('Botond Nagy', 'botond@corp.com'),
  ]);
  assert.equal(identities.length, 2);
  for (const i of identities) assert.equal(i.isBot, false, `${i.names.join(',')} should stay human`);
});

test('empty input has no identities; rawCount counts DISTINCT raw name/email pairs', () => {
  const empty = resolveIdentities([]);
  assert.equal(empty.identities.length, 0);
  assert.equal(empty.rawCount, 0);

  const res = resolveIdentities([
    commit('Alice Smith', 'alice@corp.com'),
    commit('Alice Smith', 'alice@corp.com'), // same raw pair -> not a new raw
    commit('Bob Jones', 'bob@other.org'),
  ]);
  assert.equal(res.rawCount, 2);
});

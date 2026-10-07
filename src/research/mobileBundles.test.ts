import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergedPatterns, resolveBundles, bundlesFor } from './experts.ts';
import { mobileIos, mobileAndroid } from './domainBundles.ts';
import { MOBILE_PATTERNS } from './patterns.ts';
import { MOBILE_IOS_INVARIANTS, MOBILE_ANDROID_INVARIANTS } from './invariants.ts';
import { renderPlatformContract, ANDROID_PLAY_TARGET_SDK_FLOOR } from './mobilePlatformContract.ts';

// The mobile bundles are the platform-physics experts for a shippable mobile APP. These tests enforce the
// GENERALIZATION MANDATE — the spec is the general iOS/Android
// platform contract, never a fixture's shape — plus the shared-spine + platform-contract-null properties.

// Every string field a bundle ships into a prompt or a verdict — the surface a "no fixture literals" audit runs over.
function bundleText(b: typeof mobileIos): string {
  const inv = (b === mobileIos ? MOBILE_IOS_INVARIANTS : MOBILE_ANDROID_INVARIANTS)
    .map((i) => `${i.title} ${i.aim} ${i.playbook}`).join('\n');
  const metrics = b.metricLibrary.map((m) => `${m.id} ${m.title} ${m.question} ${m.definition} ${m.nulls.join(' ')}`).join('\n');
  const pats = (b.patterns ?? []).map((p) => `${p.title} ${p.smell} ${p.question} ${p.decisiveTest} ${p.why} ${p.appliesWhen.join(' ')}`).join('\n');
  return [b.id, b.title, b.lens, b.activationSignals.join(' '), metrics, pats, inv].join('\n');
}

test('both mobile bundles register with the shared 7-pattern spine + 4 structural checks + ≥8 metrics', () => {
  for (const b of [mobileIos, mobileAndroid]) {
    assert.equal(b.patterns, MOBILE_PATTERNS, `${b.id} uses the shared mobile pattern spine`);
    assert.equal(b.patterns!.length, 7);
    assert.equal(b.structuralChecks.length, 4, `${b.id} has 4 structural checks`);
    assert.ok(b.metricLibrary.length >= 8, `${b.id} has ≥8 metrics`);
    assert.equal(typeof b.triage, 'function');
  }
  assert.equal(mobileIos.id, 'mobile-ios');
  assert.equal(mobileAndroid.id, 'mobile-android');
});

// Anti-reward-hacking gate: the SHIPPED spec must embed no secret and no real project data.
// We enforce the SECRET half mechanically here — a GENERIC secret-SHAPE scan that embeds nothing sensitive.
// (A per-value blacklist would be self-defeating: it would itself commit the project identifiers + secret
// fragments we must never persist, and would only ever cover one project.) The project SDK/class/path/id half is
// enforced by the generalization REVIEW pass (a strict reviewer reads the diff for non-generalizing literals):
// a mechanical name-blacklist cannot distinguish a project-specific symbol (a custom bridge class) from a legitimate
// platform API (WKScriptMessageHandler) without either a huge allowlist or committing the very project data.
const SECRET_SHAPES: [RegExp, string][] = [
  [/\b(sk|pk|rk|ak)_(live|test)_[A-Za-z0-9]{12,}\b/i, 'Stripe-style key (sk_live_/pk_test_…)'],
  [/\bgh[opsu]_[A-Za-z0-9]{20,}\b/, 'GitHub token (ghp_/gho_/ghs_…)'],
  [/\bxox[bposar]-[A-Za-z0-9-]{10,}\b/, 'Slack token (xoxb-/xoxp-…)'],
  [/\b[a-z]{2,}_[A-Za-z0-9]{16,}\b/, 'prefixed API key (short prefix + 16+ char body)'],
  [/\b[A-Fa-f0-9]{24,}\b/, 'long hex run (hash / DSN id / client token)'],
  [/\b[A-Za-z0-9]{40,}\b/, 'long high-entropy alnum token'],       // pure alnum: word boundaries stop it spanning /-separated prose
  [/[A-Za-z0-9+/]{24,}={1,2}/, 'base64 token with padding'],       // the `=` padding is the tell prose never carries
  [/AIza[0-9A-Za-z_\-]{20,}/, 'Google API key'],
  [/\bhttps?:\/\/[^\s"'`]*@[^\s"'`]+/, 'URL with an embedded credential/DSN'],
];
const matchesAnySecretShape = (s: string): boolean => SECRET_SHAPES.some(([re]) => re.test(s));

test('shipped spec embeds no secret-shaped literal (generic, blacklist-free)', () => {
  for (const b of [mobileIos, mobileAndroid]) {
    const hay = bundleText(b);
    for (const [re, what] of SECRET_SHAPES) {
      const m = hay.match(re);
      assert.equal(m, null, `${b.id} spec must embed no ${what}; matched: ${m?.[0]}`);
    }
  }
});

// The guard is only as good as its coverage — assert it CATCHES common real-world secret formats (synthetic
// dummies, not real values), so a future regex regression can't silently let an embedded secret through.
test('secret-shape guard catches common real-world secret formats', () => {
  const dummies = [
    'sk_' + 'live_0123456789abcdefghij0123',   // Stripe (assembled so the source holds no token-shaped literal)
    'xox' + 'b-000000000000-000000000000-abcdEFGHijklMNOPqrstUVwx', // Slack bot token
    'ghp\x5f0123456789abcdefghij0123456789abcd',  // GitHub PAT
    'AIza' + 'SyA0123456789abcdefghij0123456789x',  // Google API key
    'https://user:pass@example.com/ingest',     // credential-in-URL / DSN
    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',        // 32-hex
  ];
  for (const d of dummies) assert.ok(matchesAnySecretShape(d), `guard must catch secret format: ${d}`);
  // ...and NOT flag ordinary platform-API prose (the false positive fixed this round)
  for (const ok of ['addJavascriptInterface/@JavascriptInterface', 'WKScriptMessageHandler', 'DispatchQueue.main', 'viewModelScope/lifecycleScope'])
    assert.ok(!matchesAnySecretShape(ok), `guard must NOT flag ordinary API prose: ${ok}`);
});

// The bundles must be framework-agnostic within a platform (they cannot assume one repo's stack).
test('lenses are framework-agnostic within each platform', () => {
  const ios = mobileIos.lens.toLowerCase();
  for (const t of ['swiftui', 'uikit', 'objc', 'spm', 'cocoapods', 'carthage', 'pbxproj']) assert.ok(ios.includes(t), `ios lens covers ${t}`);
  const and = mobileAndroid.lens.toLowerCase();
  for (const t of ['compose', 'xml views', 'fragments', 'kotlin-dsl', 'groovy', 'version-catalog', 'scattered']) assert.ok(and.includes(t), `android lens covers ${t}`);
});

// The store-compliance null is the platform's OWN published contract (not an invented threshold), injected via
// the dated reference module — so the checks generalize and stay maintainable.
test('platform-contract null is injected from the dated reference', () => {
  assert.ok(mobileIos.lens.includes('App Store'), 'ios lens carries the App Store contract');
  assert.ok(mobileIos.lens.includes('privacy manifest') || mobileIos.lens.toLowerCase().includes('required-reason'), 'ios contract names the privacy-manifest / required-reason rule');
  assert.ok(mobileAndroid.lens.includes('GOOGLE PLAY') || mobileAndroid.lens.includes('Google Play'), 'android lens carries the Play contract');
  assert.ok(mobileAndroid.lens.includes(String(ANDROID_PLAY_TARGET_SDK_FLOOR)), 'android contract cites the dated targetSdk floor');
  // the reference renders non-empty for both platforms and each entry is dated (maintainable, not stale-silently)
  for (const p of ['ios', 'android'] as const) {
    const r = renderPlatformContract(p);
    assert.ok(r.length > 0 && r.includes('as of'), `${p} contract is dated`);
  }
});

// Every mobile metric must carry anti-naked-count discipline: an OVERLAY / reachability / capability / documented-
// intent cue — not "count of X". This is the mechanical guard against the reward-hacked version of each check.
test('every mobile metric definition carries an anti-naked-count / overlay cue', () => {
  const cues = ['overlay', 'reachab', 'capability', 'intersection', 'not the metric', 'never count', 'documented', 'per-repo', 'published contract', "app's own", 'declared', 'bounded', 'signature'];
  for (const b of [mobileIos, mobileAndroid]) {
    for (const m of b.metricLibrary) {
      const def = m.definition.toLowerCase();
      assert.ok(cues.some((c) => def.includes(c)), `${b.id}/${m.id} must state an overlay/anti-count discipline, got: ${m.definition.slice(0, 80)}…`);
    }
  }
});

// The shared spine composes cleanly: activating both platforms does not double the shared patterns.
test('mergedPatterns de-dupes the shared mobile spine across both bundles', () => {
  const ids = mergedPatterns([mobileIos, mobileAndroid]).map((p) => p.id);
  assert.equal(ids.length, new Set(ids).size, 'no duplicate pattern ids when both mobile bundles are active');
  for (const p of MOBILE_PATTERNS) assert.ok(ids.includes(p.id), `shared pattern ${p.id} present`);
});

// Generalization: activation must fire across DIFFERENT stacks, not just the one we designed against.
test('bundles activate across diverse stacks (not tuned to one fixture stack)', () => {
  const iosStacks = [
    'ios app, swiftui screens, swift package manager, package.resolved',   // SwiftUI + SPM
    'iphone app built with uikit + storyboards, cocoapods podfile.lock',   // UIKit + CocoaPods
    'objective-c ios app, xcodeproj, info.plist, entitlements',            // ObjC + raw project
  ];
  for (const s of iosStacks) assert.ok(bundlesFor(s).some((b) => b.id === 'mobile-ios'), `ios stack activates: ${s}`);
  const androidStacks = [
    'android app, jetpack compose, build.gradle.kts, libs.versions.toml, targetsdk 35',  // Compose + KTS + catalog
    'android app, androidmanifest, xml layout views, build.gradle groovy, minsdk 24',     // XML Views + Groovy
  ];
  for (const s of androidStacks) assert.ok(bundlesFor(s).some((b) => b.id === 'mobile-android'), `android stack activates: ${s}`);
});

// A mobile LIBRARY/SDK is NOT a mobile-app client (it routes to api-stability/swe-arch); the keyword net must
// not over-activate on library tokens a library shares with an app (Info.plist/Podfile/AndroidManifest/androidx).
test('a mobile SDK/library does not activate the mobile-app bundles', () => {
  const libs = [
    'ios sdk library with a Podfile and Info.plist for tests, no app target',
    'swiftui component library / design-system package for an ios sdk, no app target',
    'android library module with AndroidManifest and androidx dependencies, no com.android.application',
    'android library module with jetpack compose UI widgets, no com.android.application',
  ];
  for (const s of libs) {
    const ids = bundlesFor(s).map((b) => b.id);
    assert.ok(!ids.includes('mobile-ios'), `SDK/library must not activate mobile-ios: ${s}`);
    assert.ok(!ids.includes('mobile-android'), `SDK/library must not activate mobile-android: ${s}`);
  }
});

test('mobile bundles resolve as an exact manual selection', () => {
  const sel = resolveBundles(['mobile-ios', 'mobile-android'], false).map((b) => b.id).sort();
  assert.deepEqual(sel, ['mobile-android', 'mobile-ios']);
});

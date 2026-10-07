// Platform-contract reference for the mobile bundles (mobile-ios / mobile-android).
//
// The store-compliance checks judge against a HARD EXTERNAL gate — the platform's OWN published,
// currently-enforced requirements for shipping an app. Their null is therefore NOT an invented
// threshold: it is the platform contract. This module holds that contract as a small, DATED,
// value-free reference (the same posture `appsec` takes toward the public OSV advisory database) so
// it is maintainable rather than silently stale, and so no store rule is hardcoded inside a metric
// definition. NOTHING here is company-specific — these are Apple / Google platform rules only.
//
// MAINTENANCE: each entry carries `asOf`. When a platform tightens a rule (e.g. Google Play raises
// the enforced targetSdk floor after a new Android release, or Apple extends the required-reason API
// list), update the entry + its `asOf` here — the checks read from this one place. Treat a stale
// `asOf` as a reason to re-verify against the live policy before relying on the numeric floor; the
// METHOD (reconcile the repo against the published contract) is what generalizes, the constants are
// what age.

export interface PlatformContractEntry {
  id: string;
  rule: string;        // the platform's published requirement, stated value-free
  asOf: string;        // ISO date this was last verified against the live policy
  reconcile: string;   // how a static analyzer reconciles the repo against the rule
}

// ── iOS / App Store ──────────────────────────────────────────────────────────────────────────────
export const IOS_PLATFORM_CONTRACT: PlatformContractEntry[] = [
  {
    id: 'ios.privacy-manifest',
    asOf: '2026-07-09',
    rule: "Apple requires a privacy manifest (PrivacyInfo.xcprivacy) declaring data-collection and, for the "
      + "'required-reason' API families, the approved reason for each — for the app and for bundled SDKs on Apple's "
      + 'commonly-used-SDK list. A qualifying app submitted without it is rejected at App Store review.',
    reconcile: 'Check for a privacy manifest in the app and in linked SDKs; enumerate required-reason API families the '
      + 'code actually calls (file-timestamp, system-boot-time, disk-space, active-keyboard, and UserDefaults access) and '
      + 'linked tracking/attribution/analytics SDKs; flag a qualifying app with a MISSING or INCOMPLETE manifest. '
      + 'Absence of any required-reason API + tracking SDK lightens the requirement — not a false positive.',
  },
  {
    id: 'ios.required-reason-apis',
    asOf: '2026-07-09',
    rule: "Certain iOS APIs may only be used for Apple-approved reasons, declared in the privacy manifest.",
    reconcile: 'For each required-reason API family the code uses, confirm a matching reason is declared in the manifest; '
      + 'flag used-without-declared (rejection risk).',
  },
  {
    id: 'ios.permission-usage-strings',
    asOf: '2026-07-09',
    rule: 'Accessing a protected resource (camera, microphone, photos, contacts, location, tracking, …) requires a '
      + 'purpose string (NS*UsageDescription) in the app configuration; accessing one without it crashes at runtime and '
      + 'shipping tracking without an ATT prompt + NSUserTrackingUsageDescription is a review issue.',
    reconcile: 'Reconcile permission-guarded API usage against declared usage strings (however the app injects Info.plist): '
      + 'flag used-but-undeclared (crash / rejection) and declared-but-unused (over-broad).',
  },
  {
    id: 'ios.ats-default',
    asOf: '2026-07-09',
    rule: 'App Transport Security requires HTTPS by default; blanket exceptions (NSAllowsArbitraryLoads) require a '
      + 'justification at review.',
    reconcile: 'Flag a blanket ATS exception WITHOUT a documented, scoped reason; a narrow, reasoned exception is fact+reason, not a defect.',
  },
];

// ── Android / Google Play ────────────────────────────────────────────────────────────────────────
// NOTE: `playTargetSdkFloor` is the level Google Play enforces for NEW apps and UPDATES (historically
// "within one year of the latest major Android release"). It moves each year — re-verify against the
// live Play target-API policy when `asOf` is stale before treating the number as authoritative.
export const ANDROID_PLAY_TARGET_SDK_FLOOR = 35; // as of 2026-07-09 — VERIFY against the live Play policy when stale.

export const ANDROID_PLATFORM_CONTRACT: PlatformContractEntry[] = [
  {
    id: 'android.target-sdk-floor',
    asOf: '2026-07-09',
    rule: `Google Play requires new apps and updates to target a recent API level (the enforced floor is API `
      + `${ANDROID_PLAY_TARGET_SDK_FLOOR} as of this entry's date; it rises after each new Android release). An app below `
      + `the floor cannot publish an update.`,
    reconcile: `Read targetSdk from the build config; flag targetSdk < the dated floor. "No declared targetSdk" is a `
      + `separate config gap. Do not flag an app AT/above the floor.`,
  },
  {
    id: 'android.cleartext-default-deny',
    asOf: '2026-07-09',
    rule: 'Since Android 9 (API 28) cleartext (non-HTTPS) traffic is disabled by default; permitting it app-wide in a '
      + 'release build is a security-review and data-safety concern.',
    reconcile: 'Read usesCleartextTraffic / the network-security-config for the RELEASE build; flag app-wide cleartext in '
      + 'prod. A debug-only or narrowly-scoped (e.g. loopback/LAN) cleartext carve-out is healthy.',
  },
  {
    id: 'android.explicit-exported',
    asOf: '2026-07-09',
    rule: 'Since Android 12 (API 31) any component with an intent-filter must declare android:exported explicitly; an '
      + 'exported component is externally reachable and must intend to be.',
    reconcile: 'Enumerate exported components + implicit intent-filters (incl. BROWSABLE deep links); flag components '
      + 'exported without evident intent, and exported entry points that read inbound intent/extras without validation.',
  },
  {
    id: 'android.data-safety-disclosure',
    asOf: '2026-07-09',
    rule: 'Google Play requires a Data Safety disclosure consistent with the data the app + its SDKs collect; the AD_ID '
      + 'permission and tracking SDKs must be reflected in it.',
    reconcile: 'Inventory data-collecting / tracking SDKs + advertising-id usage as the disclosure surface (the form '
      + 'itself is off-repo); flag tracking/attribution SDKs present as a disclosure obligation to verify.',
  },
];

// Render a platform's contract as a value-free block for a bundle's investigative lens. The METHOD
// (reconcile the repo against the published contract) is what the agent applies; the dated constants
// are the null it measures against.
export function renderPlatformContract(platform: 'ios' | 'android'): string {
  const entries = platform === 'ios' ? IOS_PLATFORM_CONTRACT : ANDROID_PLATFORM_CONTRACT;
  const head = platform === 'ios' ? 'APP STORE (iOS) platform contract' : 'GOOGLE PLAY (Android) platform contract';
  const body = entries.map((e) => `- ${e.rule}\n    reconcile: ${e.reconcile} [rule as of ${e.asOf}]`).join('\n');
  return `${head} — the null for store-compliance is the platform's OWN published, dated requirement (not an invented `
    + `threshold; re-verify a stale rule against the live policy). Reconcile THIS repo against each; a rule the app `
    + `deviates from WITH a documented, scoped reason is fact+reason, not a defect:\n${body}`;
}

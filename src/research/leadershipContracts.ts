// Leadership authoring CONTRACTS — the report-tiers experiment (one file, five arms).
//
// WHY THIS FILE EXISTS. The leadership brief is measurably unreadable for its stated audience: the
// production report from one real run (2026-09-14) runs 9 sections · 44 English bullets · 2,023
// English words ≈ 10 minutes, and its three Bottom-line bullets are 66 / 58 / 72 words at 3 sentences
// each against a stated contract of "AT MOST 2 sentences and about 45 words".
//
// THE 72-WORD BULLET IS OBEDIENCE, NOT DISOBEDIENCE. Both prompts instruct it:
//   digest planner: "(3) ONE AGGREGATED bullet folding the remaining ACTIONABLE levers + open items."
//   author:         "+ 1 AGGREGATED catch-all of the remaining actionable levers + open items."
// A length rule layered on top of an aggregation instruction contradicts it in the same prompt, which
// is why successive length-tightening PRs have not moved the measured output. So the arms below vary
// the CONTRACT, not just the cap — and one arm varies nothing, to price the noise.
//
// The other measured volume driver is the SECTION rule: a dedicated section goes to every confirmed
// defect AND every OPEN item ("an OPEN item whose fix is to add instrumentation"), with no cap
// anywhere. Nine issues ⇒ nine sections. No rubric in reportRubric.ts bounds total length, section
// count, or bullet count; the QC loop runs up to 8 rounds against completeness rubrics that can only
// ADD. Hence v1 constrains the PLANNER (where section count is decided), not only the author.
//
// v0 IS THE CONTROL AND MUST STAY BYTE-IDENTICAL to production. Its strings below are verbatim copies
// of the pre-experiment prompt text. Do not "tidy" them — a reworded control silently becomes a sixth
// arm and every comparison against it becomes meaningless.

import { redactSecrets } from './reportEvidence.ts';
import type { LeadershipVariant } from './leadershipWriter.ts';

export interface LeadershipContract {
  id: LeadershipVariant;
  label: string;
  /** First line of the DIGEST planner prompt. */
  digestOpening: (systemKind?: string) => string;
  /** The digest planner's RULES block (bottom line + sections). */
  digestRules: string;
  /** First line of the PASS-1 AUTHOR prompt. */
  authorOpening: (systemKind?: string) => string;
  /** The author's "LEADERSHIP CONTENT — WHAT this report says" block. */
  authorContentBlock: string;
  /**
   * A visual system APPENDED after the shared house style, overriding it where they differ.
   * Kept per-variant so the area reports and the v0 control keep the house look untouched — a
   * restyle that silently changes every deliverable is not a contained change.
   */
  styleBlock?: string;
  /** Declared intent, checked by the scorer — NOT enforced in code (an enforced cap would truncate);
   *  htmlQc.wordBudgetCheck reports a brief over its `words`. */
  budget?: { words: number; bullets: number; sections: number };
  /**
   * REPORT LENS SPLIT (v5). The author is given ONLY the business-lens verdicts
   * in full, and the security / engineering lenses as COUNTS — so it cannot write about what it is not given — and the
   * house layout rules (sections, metric-card rows, charts, the three-bullet opening) are replaced by this contract's
   * shape. The capability map and the one-line Security / Engineering rows are injected after authoring.
   */
  lensSplit?: boolean;
}

// ── shared fragments ────────────────────────────────────────────────────────────────────────────

// The production framing, VERBATIM — the opening v0 must reproduce to be a control. It names the audited system
// inline and tells the planner not to assume a domain. Kept byte-identical on purpose: `v0` claims to track
// `origin/main`, and a control that paraphrases its baseline measures the paraphrase.
const mainDigestOpening = (systemKind?: string): string => {
  const kind = redactSecrets((systemKind ?? '').trim());
  return `You are PLANNING a LEADERSHIP report for a READ-ONLY audit${kind ? ` of: ${kind}` : ''} — do NOT write the report yet.
Take your framing from THAT system. Do not assume a recommendation or data-pipeline product unless the line above
says so — an audit of a build pipeline, a service codebase or a mobile app gets a report about THAT.`;
};

const mainAuthorOpening = (systemKind?: string): string => {
  const kind = redactSecrets((systemKind ?? '').trim());
  return `You are authoring a LEADERSHIP report (a single HTML page) for a READ-ONLY audit${kind ? ` of: ${kind}` : ''}.
The report's TITLE and framing come from THAT system — never assume a recommendation/data product when the audited
system is something else (a build pipeline, a service codebase, a mobile app).`;
};

// Name the audited system in the run's own words, and say plainly not to assume a domain. This IS
// production (it fixed the same defect upstream: a dev-tools audit titled itself "Data &
// Recommendation System Audit"); the no-classification branch reproduces that wording exactly, so a
// run with nothing from comprehend is framed the same way main frames it.
const kindDigestOpening = (rawKind?: string): string => {
  const systemKind = redactSecrets((rawKind ?? '').trim());
  return systemKind
    ? `You are PLANNING a LEADERSHIP report for a READ-ONLY audit of this system — do NOT write the report yet.
THE AUDITED SYSTEM (the run's own classification — frame the whole report around THIS; do not assume a
recommendation, ranking, or data-warehouse system unless the classification says so):
"""
${systemKind}
"""`
    : `You are PLANNING a LEADERSHIP report for a READ-ONLY audit — do NOT write the report yet.
Take your framing from the audited system itself. Do not assume a recommendation or data-pipeline
product — an audit of a build pipeline, a service codebase or a mobile app gets a report about THAT.`;
};

const kindAuthorOpening = (rawKind?: string): string => {
  const systemKind = redactSecrets((rawKind ?? '').trim());
  return systemKind
    ? `You are authoring a LEADERSHIP report (a single HTML page) for a READ-ONLY audit of this system.
THE AUDITED SYSTEM (the run's own classification — the report's title and framing must match THIS; do not
call it a recommendation / data / ranking audit unless the classification says so):
"""
${systemKind}
"""`
    : `You are authoring a LEADERSHIP report (a single HTML page) for a READ-ONLY audit.
The report's TITLE and framing come from the audited system — never assume a recommendation/data product
when the audited system is something else (a build pipeline, a service codebase, a mobile app).`;
};

// The Bottom-line LENGTH discipline. Defined ONCE and interpolated into every arm that wants it —
// It was moved here from two hand-copied copies precisely because the copies had already drifted, and
// an experiment whose arms disagree about the shared rule measures the drift, not the arm.
export const BOTTOM_LINE_RULE = `LENGTH IS A HARD CONSTRAINT, and the third bullet is where it breaks:
  - Each bullet is ONE LINE — a single sentence, at most ~25 words. Not two sentences,
    not two clauses joined by a semicolon. This is the summary above the summary; the section that follows carries
    the detail, the numbers and the chart. If the fix will not fit, state the problem and let the section say how.
    Three bullets of three lines each is not an executive summary, it is a page the reader skips.
  - The third is a THEME, NOT A LIST. Do NOT chain every leftover finding into one sentence. If five things remain,
    say what they have in common and cite the two that carry the most weight; the rest live in the sections, which
    is what the sections are for. An inventory of six is a FAILED bullet even when every number in it is correct.
  - BUT A THEME IS NOT AN ABSTRACTION. "The remaining risks share one shape", "several findings share one pattern",
    "automation inputs are trusted without enough binding" — these are category labels, and a reader cannot act on
    a category. State the shared failure as a CONCRETE thing that is true of the system: "approvals and release
    inputs both point at things that can change after they are checked". If you cannot say the common thread
    concretely, do not invent one — pick the single most important leftover and write that instead. Never open a
    bullet by announcing that a pattern exists.
  - THE FIX HALF IS NOT A LIST EITHER. "Require deterministic checks, bind every approval to the current revision,
    align documented and actual behaviour, and measure bot-only approvals" is the same failure wearing a verb: name
    the ONE change that does the most, and stop. Two imperatives at most, and only when they are genuinely one move.
  - NEVER append a caveat about what could not be measured ("— while several open items still need X before Y can be
    quantified"). Unsettled items are not part of the Bottom line; they have their own surface. End on the fix.
  - ONE hedge per bullet at most. Stacking qualifiers ("about 0.23, roughly 77%, outside a five-day window, if the
    sources are comparable") buys accuracy the reader cannot use — put the boundary in the section that carries it.`;

// ── v0 — PRODUCTION CONTROL (verbatim) ──────────────────────────────────────────────────────────
//
// v0 tracks `origin/main` EXACTLY, and main moved under this branch: two earlier changes landed the systemKind
// framing, the single BOTTOM_LINE_RULE, the metric cards, the 6-section cap and the THEME bullet (deleting
// the aggregated catch-all) on the DEFAULT path. The control is re-pointed at that text, so a v4-vs-v0
// comparison now measures what v4 adds OVER main's fixes, not the older prompt those fixes replaced.

const V0_DIGEST_RULES = `RULES:
• "tldr" IS THE BOTTOM LINE — EXACTLY 3 bullets, each a DISTINCT issue (the report opens with this one "Bottom line"
  block; no separate thin TL;DR). Each bullet folds its PROBLEM + its FIX into ONE line — NEVER spend two bullets on
  the same issue (do not split "the problem" and "the fix" of one issue across two bullets). Structure: (1) the
  single most important issue — its problem AND the change that fixes it, with the number; (2) the SECOND, DIFFERENT
  issue — its problem + fix; (3) a THEME bullet that NAMES the shared weakness in the remaining work and carries AT
  MOST TWO concrete levers as its evidence — then stops.
  ${BOTTOM_LINE_RULE}
  TWO HARD CONSTRAINTS ON THE BOTTOM LINE:
    (a) NO RULED-OUT / DISPUTED findings in ANY bullet, NOT EVEN the aggregated one — a refuted hypothesis or a
        "this is NOT the lever" result (e.g. "re-enabling disabled sources, +1.95pp") belongs ONLY in the
        "Checked & ruled out" note, never the Bottom line. Every Bottom-line bullet is an ACTIONABLE issue + fix.
    (b) CONCEPTUAL, NOT TECHNICAL — keep the REAL NUMBERS, but describe the mechanism as an INTERPRETED CONCEPT,
        not by asset name or code: no function/command names, no config keys, no file/table/pool/model names, no
        internal jargon. Name the BEHAVIOUR a leader can reason about — "candidates are drawn at random instead of
        by popularity", "nothing blocks a merge until someone notices", "the release can ship an input nobody
        pinned". The asset names + code live in the body sections and the engineering fix list — NOT here.
        (Those are ILLUSTRATIONS OF SHAPE drawn from other audits — use the vocabulary of THIS system, and do not
        carry another domain's subject matter into this report.)
  Each bullet substantive (finding + fix + number + consequence), not a headline, not Q&A, not a paragraph.
  Example of the SHAPE — from an UNRELATED recommendation audit; copy the form, never the subject matter:
  "Retrieval is the binding ceiling — new-user candidates are drawn at random rather than by popularity;
  taking the top items instead lifts in-pool like-rate ~74%."
• SECTIONS ARE ISSUE → TRIAGE → FIX. Give a dedicated section ONLY to an ISSUE — a confirmed defect, or an OPEN
  item whose fix is to add instrumentation. Each: the problem, then what to do. Order by impact, most-decisive first.
  AT MOST 6 SECTIONS. This is a leadership brief, not a defect register. Thirteen sections is a failure: merge the
  small ones, and let the rest live in the engineering report. Rank by what would change a decision, and cut.
• EVERY SECTION MUST BE LED BY NUMBERS, not by a paragraph. For each section give 1-3 "metrics" — {value, label} —
  that a reader could read off a card in two seconds. A section with no number is a section without evidence;
  either find its number or drop the section.
  THE LABEL IS THE HARD PART. It is read alone, with no sentence around it, so it must stand on its own in plain
  words: "checks that run before code ships", NOT "merge gates"; "how much the audit catches", NOT "recall". Write
  every label as if it were the only thing the reader sees — because on a card, it is.
• Do NOT index on PROVED-HEALTHY / RULED-OUT findings (a refuted hypothesis, or a "this is NOT the lever" result —
  e.g. "re-enabling the disabled sources only lifts the ceiling +1.95pp"). They get NO dedicated section. Fold ALL
  of them into ONE short "Checked & ruled out" item at the END — one terse line each (what we checked → why it's not
  the lever). Never let a ruled-out finding headline a section or a Bottom-line bullet.
• Restate only measured numbers/verdicts; if an ask could not
  be settled, say so plainly (don't invent a verdict).`;

const V0_AUTHOR_CONTENT = `• The "Bottom line" lead card is EXACTLY 3 INFORMATIVE bullets — 2 DISTINCT issues (each folding its own
  problem + the change that fixes it, with its number) + a THIRD that NAMES the shared weakness in the remaining work
  and carries AT MOST TWO concrete levers as its evidence, then stops. Never two bullets on the same issue.
  ${BOTTOM_LINE_RULE} It is the WHOLE executive summary — do NOT also add a separate
  thin "TL;DR" list or a bottom-line paragraph. The Bottom-line bullets keep REAL NUMBERS but stay CONCEPTUAL: no
  asset / source names, no code (zrandmember / ZREVRANGE), no config keys, and NO ruled-out / disputed finding there.
• Sections are ISSUE → TRIAGE → FIX, ordered by impact, most-decisive first: a CONFIRMED defect → the problem + the
  fix; an OPEN item → what's unknown + the instrumentation / experiment that settles it. Where two verdicts measure
  related things (a sum-with-duplicates vs a distinct count, an inferred cap vs a confirmed one), RECONCILE them
  honestly rather than presenting one as the other.
• Do NOT index on PROVED-HEALTHY / RULED-OUT findings (e.g. "re-enabling disabled sources is not the lever, +1.95pp")
  — give them NO section and NO Bottom-line bullet; collect them into ONE brief "Checked & ruled out" note near the
  end, a terse line each.`;

// ── v4 — the READ-BACK arm ──────────────────────────────────────────────────────────────────────
//
// v1 cut the document from 8.1 rendered screens to 2.2 and satisfied BLUF's core (conclusion first,
// every section leading with its own thesis). Reading it against the actual standards then exposed
// five defects the word-count could not see. v4 fixes exactly those, changing nothing else:
//
//  1. NO ASK. v1 never tells the reader what is expected of them, and ends on a provenance line.
//     BLUF's canonical example is not a finding at all, it is a request with a deadline
//     ("I need you to approve ... by noon on August 10"). The only place an ask appeared anywhere in
//     the matrix was the separate cover file, i.e. never in the report itself.
//  2. TWO SUMMARY LAYERS THAT DISAGREE. v1 opened with 3 bottom-line bullets beside 4 KPI tiles and
//     4 sections, so a reader cannot say whether the document found three problems or four. Minto:
//     a grouping is only derivable if its members are logically the same and in one logical order.
//  3. THE CHAINING DEFECT MOVED RATHER THAN DIED. Told to collapse open items into "a SINGLE closing
//     line", v1 produced one 50-word sentence of four semicolon-chained clauses — the 72-word
//     bottom-line bullet, relocated to the foot of the page.
//  4. DECORATIVE CHARTS. Rubric R6 ("a quantitative claim with no chart fails") pushed a progress bar
//     onto "1 of 2" and an empty bar onto "0%". Two of four sections carried a figure conveying
//     nothing the sentence had not.
//  5. FIRST-ORDER-ONLY CONSEQUENCES, UNSIZED NUMBERS. "about a 0.017 valid-stay lift" is the same
//     unreadable-number defect as "12.4x the median dependency load", quieter. BLUF asks for the
//     second-order effect, the one that makes a leader act.

// v4 does NOT interpolate BOTTOM_LINE_RULE, and that is deliberate: it SUPERSEDES it. The shared rule
// folds the fix into the bullet "if it fits" and makes the third bullet a THEME; v4 moves the fix into the
// section and deletes the third bullet's special role outright. Appending both would hand the planner two
// incompatible shapes for the same bullet — the exact drift the shared rule was created to prevent.
const V4_DIGEST_RULES = `RULES — this is an EXECUTIVE DECISION brief. Its value is what it LEAVES OUT and what it ASKS FOR.
The engineering report carries the full detail and this brief links to it, so you are NOT the system of record.

• ONE SUMMARY LAYER. Pick the top N issues. N is AT MOST 3 (4 only if a fourth genuinely cannot wait) and
  is BOUNDED BY THE MATERIAL: if the verdicts below contain two actionable issues, N is 2, and if they
  contain one, N is 1. NEVER pad to three. Splitting one issue into two bullets, or inventing an issue to
  fill a slot, is a fabricated finding — worse than a short report, and a short report is not a failure.
  That SAME N then governs everything: N bottom-line bullets, N headline numbers, N sections, same order,
  one number per issue. Never show a headline number for an issue that has no bullet, and never a
  bullet with no section. A reader must be able to say how many problems you found without counting.
• "tldr" IS THE BOTTOM LINE — exactly N bullets. HARD SHAPE, every bullet: ONE sentence · AT MOST 25
  words · ONE fact + ITS CONSEQUENCE + ONE number. The FIX is NOT in the bullet; it belongs to that
  issue's section. There is NO aggregated / catch-all bullet. Never chain findings with commas or
  semicolons. A bullet a non-engineer cannot repeat from memory after one read is too long.
• EVERY NUMBER MUST BE SIZED. A number a reader cannot convert into a decision is noise. "12.4x the
  median dependency load" and "about a 0.017 lift" both fail: say what it means ("one service is the
  single point of failure for 12 others"; "roughly a 2% relative gain, on 16% of users"). If you
  cannot size a number honestly from the measured material, leave the number out and state the finding.
• EVERY ISSUE CARRIES ITS SECOND-ORDER EFFECT. Not "broken tests can land" (first-order) but what that
  costs the business or the decision. State the consequence of the consequence.
• OPEN / UNSETTLED items: at most 3, as SEPARATE short items of AT MOST 15 words each. NEVER one long
  line listing them all — a single sentence carrying four semicolon-joined clauses is the exact defect
  this brief exists to remove, and moving it to the end does not fix it.
• CHARTS ONLY FOR DISTRIBUTIONS, TRENDS, OR COMPARISONS ACROSS 3+ VALUES. Never a bar for "1 of 2",
  never an empty bar for "0%", never a chart restating a single number. A figure must show something
  the sentence cannot.
• DO THE ISSUES SHARE ONE PATH? Decide this in the plan, because the writer needs to know. If two or more
  of your chosen issues are failure points along a single flow — a change reaching production, a request
  reaching a user, data reaching a table — say so explicitly and name the steps of that path in order,
  using only components your verdicts mention. The writer draws it once as a small mechanism diagram. If
  they do not share a path, say that too, so nothing decorative gets drawn.
• Do NOT index on PROVED-HEALTHY / RULED-OUT findings — ONE terse line at the end.
• BUDGET: the whole English side is AT MOST 450 words. Plan to that.
• Restate only measured numbers/verdicts.`;

const V4_AUTHOR_CONTENT = `• THIS IS AN EXECUTIVE DECISION BRIEF. Its value is what it leaves out and what it asks for. The
  engineering report carries the full detail. Completeness is NOT a goal; a brief that covers everything
  has failed. AT MOST 450 English words in the whole document.
• OPEN WITH A VERDICT SENTENCE — one plain sentence, before any card or bullet, that a non-engineer
  could repeat from memory. Say what is true and what it costs. Not "X is the most immediate concern
  identified", which survives deletion.
• CLOSE THE OPENING BLOCK WITH THE ASK — a single "What we need from you" line naming the
  DECISION required and WHO must make it BY ROLE (the engineering lead, the data owner) — you do NOT
  know the org chart, so NEVER invent a person's name. Propose a timeframe as YOUR RECOMMENDATION
  ("we recommend deciding within two weeks"); never state a deadline as though one had been given. If
  nothing is being decided, say what happens next instead. A brief that asks for nothing is a memo.
• ONE SUMMARY LAYER. Choose N = the number of actionable issues the digest actually gives you, AT MOST 3
  (4 only if a fourth cannot wait). If it gives you one or two, N is one or two — do NOT pad to three, and
  do not split one issue across two bullets to reach it. An invented issue is a fabricated finding; a
  two-issue brief is just a two-issue brief. Hold N everywhere: N bottom-line bullets, N headline numbers,
  N sections, in the same order, one number per issue. Do not show a headline number for an issue with no
  bullet. A reader must never have to wonder whether you found two problems or three.
• The "Bottom line" lead card bullets: ONE sentence · AT MOST 25 words · ONE fact + ITS CONSEQUENCE +
  ONE number. No fix in the bullet, no catch-all bullet, no chaining. Keep REAL NUMBERS but stay
  CONCEPTUAL — no asset/source names, no code, no config keys, no ruled-out finding.
• Sections are ISSUE → WHAT IT COSTS → FIX, ordered by impact. The COST line must carry the
  SECOND-ORDER effect — what it costs the business or the decision, not merely the direct consequence.
  Every body bullet obeys the bottom-line shape: one sentence, at most 25 words, one fact.
• EVERY NUMBER ARRIVES SIZED — say what it means in the same breath. If you cannot size it honestly
  from the measured material, state the finding without the number rather than shipping a bare ratio.
• CHARTS ONLY FOR DISTRIBUTIONS, TRENDS, OR 3+ VALUE COMPARISONS. Never a bar for "1 of 2" or "0%",
  never a figure restating one number. Prefer no figure to a decorative one.
• EMPHASIS — the page must not read FLAT, and must not read like confetti either. Use the house palette:
    - EXACTLY ONE highlighted span per Bottom-line bullet: the decisive number or verdict, on a soft
      --honey background (a <span class="hl">). One per bullet, never every number — a card with nine
      emphasised numbers has no emphasis, it has speckle, and the reader's eye is given nowhere to land.
    - The COST label and its consequence carry --red; the FIX label carries --green. A metric card's
      number is --red when the value IS the problem and --green when it is healthy.
    - COLOUR MUST MEAN SOMETHING and mean the SAME thing everywhere: red = this is what it costs,
      green = this is the way out, honey = look here first. Never colour for decoration.
• A MECHANISM DIAGRAM WHEN — AND ONLY WHEN — TWO OR MORE FINDINGS SIT ON ONE PATH. If the issues are
  points of failure along a single flow (a change reaching production, a request reaching a user, data
  reaching a table), draw that path ONCE, near the top, and mark where each finding breaks it. That is a
  picture a sentence cannot replace. If the findings do not share a path, draw nothing.
    - Hand-authored inline <svg> with a viewBox, native shapes and <text>. No libraries, no images.
    - AT MOST 6 boxes, left to right, on one baseline with even gaps.
    - LABEL EVERY ARROW with a verb ("merges to", "approves", "ships to"). An unlabelled arrow says
      "related somehow" and is not worth the space.
    - Structure in --espresso; --red ONLY on the steps your findings break; a missing step is a dashed
      outline labelled with what is absent. Arrowheads are a <marker> or a small <polygon>, never an image.
    - Wrap it in <figure> with a <figcaption> stating the ONE claim the picture makes, and give the <svg>
      role="img" plus an aria-label carrying that same claim.
    - EVERY box and arrow label must name something that appears in your findings. Never invent a
      component, a step or a system to complete the picture — an invented box in an audit diagram is a
      fabricated finding that happens to be drawn.
• OPEN / UNSETTLED: at most 3 SEPARATE items, AT MOST 15 words each — never one long line listing them
  all, and never semicolon-chained. Then ONE terse "Checked & ruled out" line.
• PROVENANCE IS THE CREDIBILITY. Each verdict carries ONE of three tags, and you may claim only what its
  tag supports:
    - [MEASURED · <plane>] — queried against the reader's OWN running systems. This could NOT have been
      produced by reading their repository. It is the strongest evidence in the report: say in the section
      what was measured and over what ("measured on your warehouse across 7 days and 120,000 users" —
      using THIS run's real numbers, never that example's).
    - [MEASURED · RECORDED ...] — a measurement that really happened, but not as a live query in this run
      (a recorded eval result, a public advisory database). Real evidence. Do NOT present it as a live
      reading of their systems, and do NOT demote it to a code reading either — say what produced it.
    - [READ FROM CODE] — established by reading the source. Say so plainly; it is still a finding.
  Order the report so MEASURED findings come FIRST, then RECORDED, then READ. Do not decorate a READ
  finding with measurement language, and do not report a count of what was measured: a deterministic line
  stating the split is added to the report automatically.`;

// ── v4 VISUAL SYSTEM ────────────────────────────────────────────────────────────────────────────
// The first v4 report was correct and flat: zero highlight spans, four bold runs, no figure. The
// emphasis vocabulary the rubric assumes (<hl> and the tone colours) belongs to the STRUCTURED path
// and the free-vibe writer was never asked for it. This block supplies the look directly, because
// "match our house style" is not a specification a writer can execute the same way twice.
//
// The load-bearing idea is CONTRAST BUDGET: one dark block, one accent, one big-number row. A page
// where four things shout has no emphasis at all — which is what the production report's nine bolded
// numbers in a single card demonstrated.
const V4_STYLE = `VISUAL SYSTEM (this OVERRIDES the house style above wherever the two differ — obey this one):
• PAGE: --cream #FAF8F4 ground with a faint dot grid (a repeating radial-gradient of --line at ~1px,
  ~22px pitch, very low contrast). Content column max-width ~980px, generous top padding.
• EYEBROW: one mono uppercase line, letter-spacing ~.18em, in --accent, of the form
  "<SCOPE> · <REPORT TYPE>". Small — it orients, it
  does not announce.
• HEADLINE: very large (~46px), weight 800, line-height 1.12, at most two lines. It states the FINDING.
• META STRIP under the headline: labelled pairs, bold label + mono value, separated by wide gaps —
  date, data sources, and the definition the numbers are computed on. Then a 2px --ink rule.
• THE LEAD CARD IS DARK. Near-black (#1A1512) panel, cream text, 5px --accent left edge, radius ~14px,
  generous padding. A mono eyebrow inside it naming the block ("TL;DR"). This is the ONE dark element on the page and where the eye lands first.
  - INSIDE the dark card, every decisive number wears a --accent background highlight and bold weight,
    so the numbers carry the card. Outside it, highlights are the soft honey used sparingly.
• KPI ROW directly under the lead card: white cards, 1px --line, radius ~12px, a very large (~42px,
  weight 700) number in --red, and a small --muted label beneath that says what it counts. One card per
  bottom-line bullet, same order.
• SECTIONS: a small filled rounded badge carrying the number (--accent background, cream text, mono)
  sitting left of the heading. Body text generous, line-height ~1.75.
• TABLES where three or more facts share a shape: header row in --muted with a 2px bottom rule, rows
  separated by 1px --line, numeric columns mono and right-aligned.
• ACCENT is ONE colour for the whole document: --honey #FEC240 for an audit. Use --red #C0392B only for
  a value that IS a problem and --green #2F7D54 only for one that is healthy. Never a third accent.
• Light theme only. No shadows beyond a hairline. Nothing decorative that carries no information.`;

// ── v5 — the REPORT LENS SPLIT arm ─────────────────────────────────────
//
// User feedback: the executive report should say where the BUSINESS and application logic is wrong —
// few words, many pictures — and never where the low-level implementation is wrong; the technical report is what
// management hands to engineers. The v4 brief on a real p-limit run was organized by engineering discipline (Release
// engineering, Supply-chain hardening, Code health), carried implementation detail in plain words ("0 / 3 build inputs
// pinned") and ran ~850 words with 2 charts. v5 changes WHAT the author is given, not only what it
// is told: business verdicts in full, security / engineering as counts only (vibePrompt's lens block). The one picture —
// the capability map — and the one line per other lens are injected deterministically (reportAnchors.lensBriefHtml).
const V5_DIGEST_RULES = `RULES — this is the BUSINESS brief: where the product's business and application logic is wrong, as users
and the business experience it. The engineering report carries every technical finding; you are NOT the system of record.
• "tldr" is ONE verdict sentence, then 1–3 DECISIONS needed (the decision + who decides, by role).
• One section per AFFECTED capability, in the order given, each: what users / the business experience + the size of the
  impact ONLY when a verdict gives a number. No fix details, no mechanism, no code.
• Security and engineering are COUNTS ONLY: plan nothing for them — their lines are added automatically.
• Plan no "at a glance" list, no KPI strip and no answer-back: a "What you asked us to check" block is added automatically.
• ZERO business verdicts: say so in one line and plan a compact engineering-health overview from the counts. Never
  invent a business issue.
• BUDGET: about 300 words in the whole brief.`;

const V5_AUTHOR_CONTENT = `• THIS IS THE BUSINESS BRIEF. It says where the product's BUSINESS and APPLICATION logic is wrong — what users and
  the business experience — and nothing about low-level implementation. You are given ONLY the business-lens verdicts.
  Security and engineering reach you as COUNTS ONLY and their one-line summaries are injected after you: do NOT write
  about them, do NOT guess what they are, and do NOT add a security or engineering section.
• NEVER organise the brief by engineering discipline ("Release engineering", "Code health", "Supply chain",
  "Dependency hygiene") — those are the audit's own departments, not the reader's product. Organise by capability.
  When the reader's request itself names engineering topics, do NOT turn them into an "at a glance" list or sections:
  the injected Security / Engineering-health lines already answer them — at most ONE sentence in the lead card says so.
• NOT YOURS — injected after you, deterministically: the capability map, the Security / Engineering-health lines and a
  "What you asked us to check" block that answers each of the reader's asks, line by line. Do NOT write an answer-back
  section, an "at a glance" / TL;DR list, a KPI strip or row of big numbers, or any restatement of the reader's asks —
  anywhere. Nothing of yours goes above the TITLE.
• TARGET ≈300 WORDS for everything you write. Fewer is better. A brief over
  budget is cut down automatically, sentence by sentence — so write it short the first time.
• THE SHAPE, in this order and nothing else:
    1. TITLE — one short judgement on the product.
    2. THE LEAD CARD — ONE verdict sentence a non-engineer could repeat, then "Decisions needed": 1–3 items, each the DECISION + WHO decides BY ROLE + a timeframe you RECOMMEND. You
       do not know the org chart: never a person's name, never a deadline stated as if it had been given.
       RIGHT AFTER the lead card's closing tag, write exactly this HTML comment on its own line:
       <!--capability-map-->  — the capability map (the brief's main picture) is injected there, between the lead card
       and your capability cards. Write nothing of your own in its place.
    3. ONE CARD PER AFFECTED CAPABILITY (the red / amber capabilities listed under CAPABILITIES, in that order): the
       capability name as the heading, then AT MOST 2 LINES — what users or the business actually experience, and the
       size of the impact (users / revenue / a metric) ONLY when a verdict gives that number. Each card carries its
       evidence-tier badge. No fix, no mechanism, no code, file, table or config names.
    4. At most ONE line naming the capabilities with open questions only, and ONE line for what was checked and ruled out.
       When the CAPABILITIES are the product's own map (the material says so): the headings are those names VERBATIM,
       the cards speak the product's language from the summaries given, and the two short lines name the capabilities
       examined with nothing confirmed and the ones not examined in this scan — never a module, package or file name.
• NO charts, no KPI strip, no numbered sections, no mechanism diagram. The ONE picture is the capability map, injected
  deterministically at the <!--capability-map--> comment so it always matches the findings — do not draw your own, and
  do not restate its tiles.
• ZERO BUSINESS FINDINGS (the material says so): write the TITLE, the LEAD CARD, and ONE line saying no business-logic
  issues were in scope or found in this scan — nothing else. The engineering-health overview (tiles + one line per lens)
  is injected after you: do NOT write your own summary, list or section of the counts. NEVER invent a business issue, a
  capability, a user impact or a number to fill the page — a short brief is the correct brief here.`;

const V5_STYLE = `VISUAL SYSTEM (this OVERRIDES the house style above wherever the two differ — obey this one):
• PAGE: --cream #FAF8F4 ground. Content column max-width ~920px, generous top padding.
• HEADLINE: large (~40px), weight 800, line-height 1.12, at most two lines. It states the verdict.
• THE LEAD CARD IS DARK. Near-black (#1A1512) panel, cream text, 5px --honey left edge, radius ~14px: the verdict
  sentence large, then the "Decisions needed" list. The ONE dark element on the page.
• CAPABILITY CARDS: a responsive grid of white cards (1px --line, radius ~12px), each with a 4px left edge in the
  capability's colour given under CAPABILITIES (red #C0392B · amber #FEC240 · grey #8A7E6E), a bold heading, two short
  lines, and the small evidence-tier badge.
• ONE accent colour (--honey #FEC240). Light theme only. No shadows beyond a hairline. Nothing decorative.`;

// ── the registry ────────────────────────────────────────────────────────────────────────────────

export const LEADERSHIP_CONTRACTS: Record<LeadershipVariant, LeadershipContract> = {
  v0: {
    id: 'v0', label: 'control — production as-is',
    digestOpening: mainDigestOpening, digestRules: V0_DIGEST_RULES,
    authorOpening: mainAuthorOpening, authorContentBlock: V0_AUTHOR_CONTENT,
  },
  // The ask lives INSIDE the report. The experiment ran two cover-page arms to test the alternative and
  // they settled it the other way: a separate one-screen cover is the one file an executive does not open.
  // Those arms (and the cover prompt) were deleted once they had answered the question — a reader of this file should not have to work out which arms are live.
  v4: {
    id: 'v4', label: 'decision brief — ask in-report, one summary layer, sized numbers, no decorative charts',
    digestOpening: kindDigestOpening, digestRules: V4_DIGEST_RULES,
    authorOpening: kindAuthorOpening, authorContentBlock: V4_AUTHOR_CONTENT,
    styleBlock: V4_STYLE,
    budget: { words: 450, bullets: 12, sections: 4 },
  },
  v5: {
    id: 'v5', label: 'lens split — business brief: verdict + decisions, one card per capability, injected capability map, one line per other lens',
    digestOpening: kindDigestOpening, digestRules: V5_DIGEST_RULES,
    authorOpening: kindAuthorOpening, authorContentBlock: V5_AUTHOR_CONTENT,
    styleBlock: V5_STYLE,
    budget: { words: 300, bullets: 8, sections: 0 },
    lensSplit: true,
  },
};

export function contractFor(v: LeadershipVariant | undefined): LeadershipContract {
  return LEADERSHIP_CONTRACTS[v ?? 'v0'] ?? LEADERSHIP_CONTRACTS.v0;
}

// The COVER artifact (v2 / v3) — a separate one-screen page ABOVE the full report, not a replacement.
// Deliberately starved: no charts, no sections, no duplication of the body. If a reader opens
// only this, they should still be able to act.
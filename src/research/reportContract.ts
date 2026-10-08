// The SHARED free-vibe report contract — one source of truth for every Waggle free-vibe HTML report
// (the rec-audit/leadership report via leadershipVibe).
// It holds the parts that must be IDENTICAL across reports — the house style, the recsys terminology, and the
// HOW-to-render mechanics (self-contained English HTML, the bullet format, chart/table correctness, output).
// Each report adds only its WHAT-to-say content rules on top. Consolidating here means a fix lands in all at once.

// Waggle house style — the same look as the structured report (recallReportHtml.ts) and the console frontend.
export const THERESA_STYLE = `HOUSE STYLE — match the Waggle report design (the same look as our standard reports + console). Obey it:
PALETTE (use these EXACT values, via CSS variables): ink/text --espresso #3E261C · secondary --ink2 #5a4a3d ·
  accent (bars, left-borders, highlights) --honey #FEC240 · labels/section-numbers/links --honey-link #9A6A0E ·
  page bg --cream #FAF8F4 · card bg --card #FEFDFC · borders/dividers --line #E7E0D4 · meta/caption --muted #8A7E6E ·
  problem/cold --red #C0392B · healthy/coverage --green #2F7D54. Light theme only — never a dark background.
TYPE: body font -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height 1.7. Use a MONOSPACE (ui-monospace, Menlo) ONLY for small UPPERCASE eyebrow labels, the section
  numbers, and the meta line — letter-spacing ~.13em, colored --honey-link.
COMPONENTS (reuse these conventions): never put content inside an element id'd "repTopbar" (the host console hides it); an optional tiny uppercase mono brand-mark eyebrow may sit at the top-left. A "bottom line" LEAD card
  (card bg, 1px --line border, a 4px --honey LEFT border, radius ~13px); metric CARDS (card bg, 1px --line, radius
  ~12px, a big ~23px/600 number + a small --ink2 label); SECTIONS separated by a top --line border, each opening with
  a mono section number (01, 02 …) in --honey-link; horizontal value BARS with track #F3EEE4 + --honey fill (coverage
  bars filled --green); tables with a #F3EEE4 header row. Rounded corners, subtle 1px borders, NO heavy shadows.
  Calm, generous, print-clean.`;

// Ranking/recsys terminology — the STANDARD term for each concept, so the report reads naturally to a recsys team.
// PLUS: keep a term VERBATIM when it names a SPECIFIC EXISTING ASSET (a particular retrieval source / pool / key /
// model / config) — renaming an asset makes it unfindable; explain CONCEPTS, keep NAMES.
export const RECSYS_GLOSSARY = `RANKING / RECSYS TERMINOLOGY — use the standard term for each concept; keep top-K / AUC / A·B / CTR as-is.
The two "recall"s are DIFFERENT concepts — do not conflate them:
  • recall as the candidate-generation STAGE ("retrieval") vs recall@k, the METRIC ("how much it catches").
  • ranking — the MODEL/STAGE that scores & orders candidates (coarse ranking · re-ranking) — vs the generic act of
    putting a list in order ("random ordering"). Say "the ranking model", "ranking quality", "before ranking".
  • candidate pool · cold start · serving · embedding · two-tower model · popularity · relevance · feature ·
    click-through rate · coverage · engagement · impression · session · like rate · watch-through / completion ·
    effective dwell · served slate — use these words, not a literal translation of an internal label.
KEEP VERBATIM (do NOT translate or rename it) any term that names a
SPECIFIC EXISTING ASSET: a named retrieval source, a candidate pool / cache key, a model, a config flag. Explain it
in plain words on first mention, but the NAME itself stays as-is so the team can find it.`;

// The shared HOW-to-render contract — appended (verbatim) to every free-vibe report's author prompt. It embeds the
// house style + glossary, then the mechanics every report obeys. The caller's prompt supplies the material and the
// report-SPECIFIC content rules (what the Bottom line says, leadership issue-triage vs accel-mini answer-the-question,
// open questions, work items) BEFORE this block.
export const FREE_VIBE_CONTRACT = `${THERESA_STYLE}

${RECSYS_GLOSSARY}

WRITE THE HTML — your judgement on layout WITHIN the house style above, obeying these HARD rules (the same contract
for every Waggle free-vibe report):
1. ONE complete, SELF-CONTAINED HTML document: start with <!DOCTYPE html>, end with </html>. Inline <style> only;
   system font stack; NO external resource (no CDN, web font, <img> URL, fetch/XHR). No <script> is needed.
2. ENGLISH — write the whole report in English. EVERY label — eyebrows, card titles, section headings, chart axes,
   metric captions, the ask — is in English. If the material carries domain vocabulary in another language, write
   the English term. Identifiers pass through unchanged: a table, column, function or config name
   (\`content_counter_snapshot_daily\`, AUC), and numbers.
3. BULLETS, NOT PROSE — the reader SCANS. Open with a "Bottom line" lead card (the house-style left-honey-
   border card) whose key points are a REAL bulleted <ul> with visible bullets. Render every section's findings /
   evidence / next-steps as bullet lists, ONE point per line — never a wall of dense prose (a wall of prose is the #1
   failure); a short one-sentence lead-in per section is fine, you may nest ONE level. Put the headline numbers in
   metric CARDS. (The caller specifies WHAT the Bottom line and sections say.)
4. PLAIN WORDS for MECHANISMS, the standard TERMS (the glossary above), asset
   NAMES kept verbatim. Translate a mechanism into plain words (e.g. "logq_weight 5.0× vs 1.0×" → "a popularity
   correction applied about five times its documented strength"). You MAY cite a specific file / table / key when it
   is the precise point, but explain it in plain words on first mention; never bury the point in code/jargon. Avoid
   gratuitous snake_case / metric-code noise that names nothing.
5. NUMBERS woven into sentences in plain language, at most one per bullet; introduce NO number not in the material above.
6. VISUALIZE where it helps — your OWN inline SVG / CSS charts (bars / donuts / split / coverage bars / tables) built
   ONLY from the numbers above; never invent a value to fill a chart. CHART/TABLE CORRECTNESS is mandatory — after
   drawing each one, VERIFY it renders right and FIX it if not:
     • a bar's WIDTH must be proportional to its value on a STATED scale (e.g. on a 0–1 scale, 0.456 ≈ 46% of the
       track) — never a width that contradicts the number beside it; show the scale / reference line.
     • tables: every row has the SAME number of cells as the header, columns align, no empty / merged-by-accident
       cells, numbers right-aligned.
     • SVG: a valid viewBox, coordinates inside it, nothing clipped or overlapping; donut / segment angles sum correctly.
   A chart that would render visibly wrong is worse than none — drop it or fix it. A purely qualitative point needs no
   chart.
   WHEN NOT TO DRAW ONE — a correct chart of one number is still the wrong chart:
     • A CHART NEEDS AT LEAST 3 COMPARED VALUES. One value, or a two-part share, is a STAT TILE — the number IS
       the chart. Never a single-bar track ("1 of 2" as a half-filled bar, "0%" as an empty one — an empty track
       shows nothing at all), never a two-slice donut, never a coverage bar that restates the tile beside it.
     • NO CHART WHOSE ONLY CONTENT IS A NUMBER ALREADY SHOWN. A lone bar restating a headline tile adds
       nothing. But a chart that puts that same number IN CONTEXT — beside the other windows, against the
       threshold that decides it, next to the baseline it must beat — is exactly what a chart is for, and
       it is NOT a duplicate. Ask what the figure adds beyond the number, not whether the number appears
       twice.
     • ONE SCALE PER PLOT. Never two y-scales on one chart — the alignment is arbitrary and invents a correlation
       the data does not contain. Two measures of different size ⇒ two charts, or index both to a common base.
     • NO VALUE-RAMP ON UNORDERED CATEGORIES (darker = bigger across services / teams / sources). It re-encodes
       bar length as shade and spends the only free channel on what the length already says. One series, one fill.
     • SELECTIVE LABELS ONLY — never a number on every bar; label the extreme or the one that carries the point.
     • THIN MARKS, SOLID HAIRLINE RULES. No dashed gridlines (dashing reads as "projection" or "threshold"), no
       heavy blocks, no border drawn around marks to separate them — use a small gap on the surface instead.
     • A label must never be clipped by its own bar: if it does not fit inside with padding, put it outside the
       bar end.
7. Self-contained, print-clean, calm — on the house style. No placeholder / "lorem", no TODO, no commentary.
8. STANDARD TERMINOLOGY, NO METAPHORS / NICKNAMES — name every problem with widely-understood technical terms,
   never a metaphor or coined nickname. Write "too many responsibilities and dependencies" (not "god object" / "god
   file"), "single-owner risk / bus factor" (not "the hero"), "tightly coupled, hard to change independently" (not
   "spaghetti code"). Describe the actual property/mechanism,
   not a vivid label — a metaphor that hides the real mechanism is a failure.

OUTPUT: ONLY the HTML document. No prose before <!DOCTYPE, no commentary after </html>, no code fence.`;

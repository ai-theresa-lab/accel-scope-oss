// The ONE REMEDIATION.md builder, shared verbatim by
//   - the report's own Export + the serve-time /share retrofit (reportHtml.ts REMEDIATION_EXPORT_JS), and
//   - the console's run-page / library export (serverUi.ts exportRemediation),
// and evaluated with `new Function` by the unit tests (remediationMd.test.ts), so all three produce the same file.
//
// "a REMEDIATION.md an agent can run":
//   (a) sections ordered by severity, then effort (quick wins first within a severity), then the original order;
//   (b) findings that share the same primary evidence FILE (first evidence ref, line range stripped) AND the same
//       lens are merged: the highest-severity one keeps the section, the others become "Also covers: F-xx — title";
//   (c) the section id is the `displayId` ('F-01'…); a report stored before display ids gets the same ordering
//       computed here (severity, then confidence, then original order — confirmed rows only);
//   (d) ruled-out rows (`status: 'ruled-out'`, the older `ruledOut` flag, or the legacy isRuledOutFinding
//       encoding: severity info + a "Source: recommendation-audit" row) are a final "Checked and ruled out — no
//       action" list with titles prefixed "Ruled out:", never numbered sections;
//   (e) a short "How to use this file" preamble for a coding agent;
//   (f) each section keeps Evidence / Recommended fix / Acceptance (when present);
//   (g) report lens split: SECURITY-lens findings (the view model's
//       `reportLens`) come first — the same security-first order as the Execution Work plan — then (a) applies.
//       Section ids stay the F-ids, so a security section can be F-04: the ordering never renumbers.
// The header count stays the CONFIRMED finding count (= run.findings), merged or not.
//
// PURE ES5 (no DOM), embedded into <script> blocks: no backticks, no ${…}, no </script>.
export const REMEDIATION_MD_JS = String.raw`
function remediationIsRuledOut(f){
  if (!f) return false;
  if (f.status === 'ruled-out') return true;
  if (f.status === 'confirmed') return false;
  if (f.ruledOut === true) return true;
  if (f.ruledOut === false) return false;
  if (f.severity !== 'info') return false;
  return (f.remediation || []).some(function(r){ return r && r.k === 'Source' && r.v === 'recommendation-audit'; });
}
var REM_SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
var REM_CONF_RANK = { high: 0, medium: 1, low: 2 };
function remSevRank(f){ var r = REM_SEV_RANK[String((f && f.severity) || '').toLowerCase()]; return r == null ? 5 : r; }
function remConfRank(f){ var r = REM_CONF_RANK[String((f && f.confidence) || '').toLowerCase()]; return r == null ? 3 : r; }
// Effort: the view model's effortRank (quick_win 1 · moderate 3 · project 6 · unknown 4), else the raw effort word.
function remEffortRank(f){
  if (f && typeof f.effortRank === 'number') return f.effortRank;
  var e = String((f && (f.effort || f.effortLabel)) || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (e === 'quick_win' || e === 'low' || e === 'small') return 1;
  if (e === 'moderate' || e === 'medium') return 3;
  if (e === 'project' || e === 'large' || e === 'high') return 6;
  return 4;
}
function remLensRank(f){ return (f && f.reportLens === 'security') ? 0 : 1; }
function remTitle(f){ return String((f && (f.claim || f.title)) || 'Finding').replace(/\s+/g, ' ').trim() || 'Finding'; }
// The primary evidence FILE: the first evidence ref with any :line / :line-line / #Lx suffix removed.
function remPrimaryPath(f){
  var ev = (f && f.evidence) || [];
  var ref = ev.length && ev[0] ? String(ev[0].ref || '').trim() : '';
  return ref.replace(/#L\d+(-L?\d+)?$/i, '').replace(/:\d+(-\d+)?(:\d+)?$/, '');
}
function remLens(f){ return String((f && (f.lensKey || f.lens || f.dimension)) || ''); }
function remRuledOutTitle(f){
  var t = remTitle(f);
  return /^ruled out:/i.test(t) ? t : 'Ruled out: ' + t;
}
// displayId per confirmed finding: the embedded display id when present, else the same order computed here.
function remediationDisplayIds(act){
  var idx = act.map(function(f, i){ return i; });
  idx.sort(function(a, b){ return (remSevRank(act[a]) - remSevRank(act[b])) || (remConfRank(act[a]) - remConfRank(act[b])) || (a - b); });
  var ids = [];
  idx.forEach(function(i, n){ ids[i] = (n + 1 < 10 ? 'F-0' : 'F-') + (n + 1); });
  return act.map(function(f, i){ return (f && f.displayId) ? String(f.displayId) : ids[i]; });
}
// The ordered, de-duplicated section plan: [{ f, id, covers: [{ f, id }] }]. Exposed for tests.
function remediationSections(all){
  var act = (all || []).filter(function(f){ return !remediationIsRuledOut(f); });
  var ids = remediationDisplayIds(act);
  var order = act.map(function(f, i){ return i; });
  order.sort(function(a, b){ return (remLensRank(act[a]) - remLensRank(act[b])) || (remSevRank(act[a]) - remSevRank(act[b])) || (remEffortRank(act[a]) - remEffortRank(act[b])) || (a - b); });
  var sections = [], byKey = {};
  order.forEach(function(i){
    var f = act[i], p = remPrimaryPath(f);
    var key = p ? (remLens(f) + '|' + p) : '';
    // Sorted by severity first, so the first row seen for a key is the highest-severity one: it keeps the section.
    if (key && byKey[key]) { byKey[key].covers.push({ f: f, id: ids[i] }); return; }
    var s = { f: f, id: ids[i], covers: [] };
    if (key) byKey[key] = s;
    sections.push(s);
  });
  return sections;
}
function remediationMarkdown(o){
  var all = o.findings || [];
  var act = all.filter(function(f){ return !remediationIsRuledOut(f); });
  var out = all.filter(remediationIsRuledOut);
  var sections = remediationSections(all);
  var md = '# Remediation — ' + o.title + '\n\n';
  md += '_' + (o.before || '') + act.length + ' finding' + (act.length === 1 ? '' : 's') + (out.length ? ' · ' + out.length + ' ruled out' : '') + (o.after || '') + '_\n\n';
  if (!all.length) { md += (o.emptyNote || 'Open the interactive report for the full diagnosis — no findings were embeddable for export.') + '\n'; return md; }
  if (sections.length) {
    md += '## How to use this file\n\n';
    var secFirst = sections.some(function(s){ return remLensRank(s.f) === 0; });
    md += 'You are a coding agent working through this list. Work top to bottom — sections are ordered ' + (secFirst ? 'security first, then ' : '') + 'by severity, then effort (quick wins first).\n\n';
    md += '- Make one commit per section, and reference its id (e.g. ' + sections[0].id + ') in the commit message.\n';
    md += '- Run the test suite after each section; do not start the next one while tests fail.\n';
    // Only explain the parts this file actually has — a preamble describing absent sections reads as a missing part.
    if (sections.some(function(s){ return s.covers.length; })) md += '- A section marked "Also covers" fixes several findings that point at the same file — one change should close all of them.\n';
    if (out.length) md += '- The "Checked and ruled out" list at the end is not work: leave those areas alone.\n';
    md += '\n';
    if (sections.length !== act.length) md += '_' + act.length + ' findings in ' + sections.length + ' section' + (sections.length === 1 ? '' : 's') + ' (findings on the same file and lens are merged)._\n\n';
  }
  sections.forEach(function(s){
    var f = s.f;
    md += '## ' + s.id + ' · [' + String(f.severity || '').toUpperCase() + '] ' + remTitle(f) + '\n\n';
    var meta = [];
    if (f.lensLabel) meta.push(String(f.lensLabel));
    if (f.effortLabel || f.effort) meta.push('effort: ' + (f.effortLabel || f.effort));
    if (f.confidence) meta.push('confidence: ' + f.confidence);
    if (meta.length) md += '_' + meta.join(' · ') + '_\n\n';
    if (f.detail) md += f.detail + '\n\n';
    if (f.business) md += '**Business impact:** ' + f.business + '\n\n';
    var ev = f.evidence || [];
    if (ev.length){ md += '**Evidence:**\n'; ev.forEach(function(e){ md += '- ' + (e.ref || '') + (e.detail ? (' — ' + e.detail) : '') + '\n'; }); md += '\n'; }
    var rows = f.remediation || [], fix = '', acc = f.acceptance || '';
    rows.forEach(function(r){ if (!r) return; if (r.k === 'Recommendation' || r.k === 'Recommended fix') fix = fix || r.v; else if (r.k === 'Acceptance') acc = acc || r.v; });
    if (!fix && f.recommendation) fix = f.recommendation;
    if (fix) md += '**Recommended fix:** ' + fix + '\n\n';
    rows.forEach(function(r){
      if (!r || !r.v) return;
      if (r.k === 'Recommendation' || r.k === 'Recommended fix' || r.k === 'Acceptance' || r.k === 'Source' || r.k === 'Effort' || r.k === 'Confidence') return;
      md += '**' + r.k + ':** ' + r.v + '\n\n';
    });
    if (acc) md += '**Acceptance:** ' + acc + '\n\n';
    // Execution report (two-report model): the re-runnable check that proves the fix — a query as a code block.
    // (\x60 = backtick: this builder is a String.raw template literal, so a literal backtick would end it.)
    if (f.verify) md += '**How to verify:**\n\n' + (f.verifyKind === 'query' ? '\x60\x60\x60\n' + String(f.verify).replace(/\x60{3}/g, "'''") + '\n\x60\x60\x60' : String(f.verify)) + '\n\n';
    if (s.covers.length){
      md += '**Also covers:**\n';
      s.covers.forEach(function(c){ md += '- ' + c.id + ' — ' + remTitle(c.f) + ' [' + String(c.f.severity || '').toUpperCase() + ']\n'; });
      md += '\n';
    }
  });
  if (out.length){
    md += '## Checked and ruled out — no action\n\n_Checked and found healthy — listed for completeness, not remediation items._\n\n';
    out.forEach(function(f){ md += '- ' + remRuledOutTitle(f) + (f.detail ? (' — ' + f.detail) : '') + '\n'; });
    md += '\n';
  }
  return md;
}
`;

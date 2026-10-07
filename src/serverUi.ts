// The accel-scope console SHELL, served by src/server.ts — a single-user, self-hosted app (no login). One coherent
// product in the accel-scope design system (espresso / honey / cream, Geist, the bee icon) — same visual language as
// the generated report (src/reportHtml.ts).
//
// Real routing: /connect · /ask · /run · /report · /memory · /settings (history API; server serves this SPA for every
// non-/api path). Connect = a clickable source list that drives the connect panel. Run = a Target that lists EVERY
// connected source's artifacts (repos, folders) as toggles. Report = the real report.html embedded. Settings = API
// keys, the per-run spending cap and telemetry. Thin client — all logic talks to /api.

import { readFileSync } from 'node:fs';
import { REMEDIATION_MD_JS } from './remediationMd.ts';

const BEE_DATA_URI = (() => {
  const png = readFileSync(new URL('./assets/logo.png', import.meta.url));
  return `data:image/png;base64,${png.toString('base64')}`;
})();

export const CONNECT_SUCCESS_CLEAR_FIELD_IDS: Record<string, readonly string[]> = {
  github: ['ghToken'],
  warehouse: ['whSaJson', 'whUrl', 'whToken'],
  keyvalue: ['kvUrl', 'kvToken'],
  local: ['localPath'],
  giturl: ['giturlUrls'],
};

export function connectSuccessClearFieldIds(kind: string): readonly string[] {
  return CONNECT_SUCCESS_CLEAR_FIELD_IDS[kind] ?? [];
}

const CONNECT_SUCCESS_CLEAR_FIELDS_JSON = JSON.stringify(CONNECT_SUCCESS_CLEAR_FIELD_IDS);

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}
:root{--espresso:#3E261C;--espresso-hover:#2A1A12;--honey:#FEC240;--honey-link:#855B0B;--cream:#FAF8F4;--cream-card:#FEFDFC;--line:#E7E0D4;--muted:#6F6354;--ink2:#5a4a3d;
/* --muted / --num / --honey-link / --nav-muted were 2.9–4.2:1 on the cream surfaces; now ≥4.5:1 (AA) on
   --cream, --cream-card, --card2 and --honey-soft (serverUi.test.ts computes the ratios from these very tokens). */
--focus-ring:0 0 0 2px var(--cream),0 0 0 4px #855B0B;
/* redesign tokens (console redesign) */
--num:#855B0B;--card2:#FBF3E2;--honey-soft:#FBEFD2;--honey-tint:#FBF0D9;--card-shadow:0 8px 22px rgba(62,38,28,.06);--track:#ECE4D6;--font-mono:'Geist Mono',ui-monospace,monospace;
--ok:#256B46;--ok-soft:#DCF0E4;--crit:#C0392B;--high:#D97B2B;--high-ink:#A85512;--high-soft:#FBE6D2;--term-bg:#201711;
--nav-bg:#3E261C;--nav-fg:#EFE3D6;--nav-fg2:#C9B6A4;--nav-strong:#FBF6EC;--nav-muted:#B09176;--nav-line:rgba(255,255,255,.12);--nav-hover:rgba(255,255,255,.06);--nav-accent:#C79A57;--nav-active:rgba(254,194,64,.15);--nav-w:256px;--content-wide:1560px;--prose-max:920px;}
/* Console polish (2026-10-03): every console font size was scaled ~7% (13→14px body text, 11→12px labels, headings in
   proportion; rounded to .5px) and --content-wide went 1400→1560px — the Report library, Full Scan / Quick Ask, Memory
   and Connect columns all use it, with 30px side padding; PROSE blocks stay capped at --prose-max for line length. */
/* ============ DARK THEME (default) — flip the dual-role --espresso to a light INK, then re-pin every dark surface ============ */
[data-theme=dark]{
  --espresso:#F1E6D8;
  --cream:#120D08;--cream-card:#1C150E;--card2:#241A12;--line:#33261B;
  --muted:#9C7F66;--ink2:#C9B6A4;
  --num:#FEC240;--honey-link:#FEC240;
  --honey-soft:rgba(254,194,64,.14);--honey-tint:rgba(254,194,64,.10);
  --card-shadow:0 8px 22px rgba(0,0,0,.45);--track:#33261B;--term-bg:#0A0705;
  --ok:#5DBE8B;--ok-soft:rgba(93,190,139,.16);--high-soft:rgba(217,123,43,.18);--high-ink:#D97B2B;
  --focus-ring:0 0 0 2px var(--cream),0 0 0 4px #FEC240;
}
body[data-theme=dark]{background:var(--cream);color:#F1E6D8;}
[data-theme=dark] .ctx-topbar{background:rgba(18,13,8,.92);}
[data-theme=dark] .sidebar{background:#0C0805;}
[data-theme=dark] .field input,[data-theme=dark] .field select,[data-theme=dark] .field textarea{background:var(--card2);}
[data-theme=dark] .cbx{background:var(--card2);border-color:var(--muted);}
[data-theme=dark] .cfg-radio.on .cfg-radio-sub{color:var(--ink2);}
[data-theme=dark] #reportFrame{background:#17100A;}
[data-theme=dark] .btn{background:#2A1C13;color:#F1E6D8;}
[data-theme=dark] .btn:hover{background:#33231A;}
[data-theme=dark] .ctx-action.esp{background:#2A1C13;color:#F1E6D8;}
[data-theme=dark] .ctx-action.esp:hover{background:#33231A;}
[data-theme=dark] .src-card.on .src-mono{background:#3E261C;border-color:#3E261C;}
[data-theme=dark] .src-mono{background:var(--card2);color:#FEC240;border-color:var(--line);}
[data-theme=dark] .report-toggle button.on{background:#3E261C;color:#F1E6D8;border-color:#3E261C;}
[data-theme=dark] .cdfab{background:#2A1C13;}
[data-theme=dark] .cd-msg.user{background:#3E261C;}
[data-theme=dark] .cd-send{background:#2A1C13;}
[data-theme=dark] .cd-mp button.on{background:#3E261C;border-color:#3E261C;}
[data-theme=dark] .side-cta,[data-theme=dark] .btn.honey,[data-theme=dark] .ctx-action.honey,[data-theme=dark] .mem-b-glyph,[data-theme=dark] .g-dot.running{color:#3E261C;}
[data-theme=dark] .cbx.on:after{border-left-color:#3E261C;border-bottom-color:#3E261C;}
[data-theme=dark] .g-kind,[data-theme=dark] .np-idx,[data-theme=dark] .np-dispo.dispo-eval,[data-theme=dark] .g-bundle.on,[data-theme=dark] .cd-chip,[data-theme=dark] .cd-head .av,[data-theme=dark] .cd-list .row.on,[data-theme=dark] .cd-msg.asst .b code,[data-theme=dark] .pstage.active,[data-theme=dark] .g-node.running,[data-theme=dark] .g-lnode.running{background:var(--honey-tint);}
[data-theme=dark] .mem-b-side{background:var(--cream);}
[data-theme=dark] .np-res{background:var(--card2);}
[data-theme=dark] .g-dot.done{background:rgba(93,190,139,.16);color:#7FD0A3;border-color:rgba(93,190,139,.4);}
[data-theme=dark] .g-dot.failed{background:rgba(192,57,43,.16);color:#E8A89B;border-color:rgba(192,57,43,.4);}
[data-theme=dark] .g-node.failed,[data-theme=dark] .g-lnode.failed{background:rgba(192,57,43,.12);}
[data-theme=dark] .sbadge.warn{background:rgba(217,123,43,.16);color:#E6B27A;}
[data-theme=dark] .sbadge.info{background:var(--honey-tint);color:#FEC240;}
[data-theme=dark] .sbadge.err{background:rgba(192,57,43,.16);color:#E8A89B;}
html{scroll-behavior:smooth;}
body{background:#FAF8F4;font-family:'Geist',system-ui,sans-serif;color:#3E261C;-webkit-font-smoothing:antialiased;line-height:1.5;height:100vh;display:flex;flex-direction:row;overflow:hidden;}
::selection{background:#FEC240;color:#3E261C;}
.mono{font-family:'Geist Mono',ui-monospace,monospace;}
.eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
.scrolly::-webkit-scrollbar{width:9px;height:9px;}.scrolly::-webkit-scrollbar-thumb{background:#E7E0D4;border-radius:9px;}
input,select,button,textarea{font-family:inherit;}

/* ---- app shell: left sidebar + main ---- */
.sidebar{width:256px;flex:none;background:var(--espresso);color:#EFE3D6;display:flex;flex-direction:column;padding:18px 14px;}
.side-brand{display:flex;align-items:center;gap:10px;padding:6px 8px 18px;}
.bee{width:30px;height:30px;border-radius:8px;box-shadow:0 2px 7px rgba(62,38,28,.16);overflow:hidden;flex:none;}
.side-brand .bee{width:34px;height:34px;border-radius:9px;box-shadow:0 2px 8px rgba(0,0,0,.3);background:var(--cream);}
.side-brand .nm{font-weight:600;font-size:16px;color:#FBF6EC;letter-spacing:-.01em;line-height:1.15;}
.side-brand .eb{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#C79A57;}
.side-cta{display:flex;align-items:center;justify-content:center;gap:7px;background:var(--honey);color:var(--espresso);border:none;border-radius:10px;padding:11px;font-size:14.5px;font-weight:600;cursor:pointer;margin-bottom:18px;}
.side-cta:hover{background:#FFD166;}
.side-eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--nav-muted);padding:0 8px 8px;}
.nav{display:flex;flex-direction:column;gap:3px;}
.navitem{position:relative;display:flex;align-items:center;gap:11px;border:none;border-radius:9px;padding:10px 12px;cursor:pointer;text-align:left;font-size:14.5px;font-weight:500;background:transparent;color:#C9B6A4;transition:background .14s;}
.navitem:hover{background:rgba(255,255,255,.05);}
.navitem.active{background:rgba(254,194,64,.15);color:#FBF6EC;}
.navitem .bar{position:absolute;left:-14px;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:transparent;}
.navitem.active .bar{background:var(--honey);}
.navitem .glyph{font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;width:18px;text-align:center;opacity:.85;}
.navitem .lbl{flex:1;}
.rf-cnt{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:inherit;opacity:.85;}
.rf-cnt:empty{display:none;}
.side-foot{margin-top:auto;border-top:1px solid rgba(255,255,255,.09);padding-top:14px;}
.side-status{display:flex;align-items:center;gap:7px;padding:0 8px 11px;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:#A98D74;}
.side-status .d{width:7px;height:7px;border-radius:50%;background:#5DBE8B;flex:none;}
.dot{width:7px;height:7px;border-radius:50%;background:#2F7D54;}
.btn{background:var(--espresso);color:#fff;font-size:14.5px;font-weight:500;border:none;border-radius:9px;padding:9px 16px;cursor:pointer;transition:background .15s;}
.btn:hover{background:var(--espresso-hover);}.btn[disabled]{opacity:.45;cursor:not-allowed;}
.btn.ghost{background:var(--cream-card);color:var(--espresso);border:1px solid var(--line);}.btn.ghost:hover{border-color:var(--espresso);}
.btn.honey{background:var(--honey);color:var(--espresso);}.btn.honey:hover{background:#7C540A;color:#fff;}
.btn.gh{background:#1f1300;color:#fff;display:inline-flex;align-items:center;gap:8px;}
.panel[data-panel=run] .btn:not(.ghost),
.panel[data-panel=report] .btn:not(.ghost),
.panel[data-panel=memory] .btn:not(.ghost){background:var(--honey);color:#3E261C;border:none;border-radius:9px;font-weight:600;}
.panel[data-panel=run] .btn:not(.ghost):hover,
.panel[data-panel=report] .btn:not(.ghost):hover,
.panel[data-panel=memory] .btn:not(.ghost):hover{background:#FFD166;color:#3E261C;}
.panel[data-panel=run] .btn.ghost,
.panel[data-panel=report] .btn.ghost,
.panel[data-panel=memory] .btn.ghost{background:var(--cream-card);color:var(--espresso);border:1px solid var(--line);border-radius:9px;font-weight:500;}
.panel[data-panel=run] .btn.ghost:hover,
.panel[data-panel=report] .btn.ghost:hover,
.panel[data-panel=memory] .btn.ghost:hover{border-color:var(--muted);background:var(--cream-card);}
.main{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;}
.boot-loading{position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:var(--cream);}
.boot-loading[hidden]{display:none;}
.boot-spin{width:32px;height:32px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--honey);animation:boot-spin .8s linear infinite;}
@keyframes boot-spin{to{transform:rotate(360deg);}}
.ctx-topbar{flex:none;background:rgba(250,248,244,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 30px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 10px rgba(62,38,28,.05);z-index:30;}
.ctx-eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
.ctx-title{font-size:15.5px;font-weight:600;letter-spacing:-.01em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ctx-right{margin-left:auto;display:flex;align-items:center;gap:12px;flex:none;}
.ctx-meta{font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;color:var(--muted);white-space:nowrap;}
.ctx-action{border-radius:9px;padding:9px 16px;font-size:14px;font-weight:500;cursor:pointer;border:1px solid transparent;}
.ctx-action.honey{background:var(--honey);color:var(--espresso);}.ctx-action.honey:hover{background:#7C540A;color:#fff;}
.ctx-action.esp{background:var(--espresso);color:#fff;}.ctx-action.esp:hover{background:var(--espresso-hover);}
.ctx-action[hidden]{display:none;}
/* live-run bar + theme toggle */
.ctx-run{display:flex;align-items:center;gap:11px;min-width:0;flex:1 1 0;overflow:hidden;}
.ctx-dots{display:flex;align-items:center;gap:5px;flex:none;}
.ctx-dot{width:8px;height:8px;border-radius:50%;background:var(--track);flex:none;transition:background .2s;}
.ctx-dot.done{background:var(--honey);}
.ctx-dot.now{box-shadow:0 0 0 4px rgba(254,194,64,.22);animation:tlPulse 1.6s ease-in-out infinite;}
.ctx-stage{font-family:var(--font-mono);font-size:12px;color:var(--muted);white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.ctx-lead{display:flex;align-items:center;gap:12px;min-width:0;}
.ctx-eyebrow .live{display:inline-flex;align-items:center;gap:7px;color:var(--high);}
.ctx-eyebrow .live .ld{width:8px;height:8px;border-radius:50%;background:var(--high);flex:none;animation:liveGlow 1.5s ease-in-out infinite;}
.ctx-eyebrow .live.done{color:var(--high);}
.ctx-eyebrow .live.done .ld{background:var(--high);animation:none;box-shadow:none;}
.ctx-eyebrow .live.done.ok{color:var(--ok);}
.ctx-eyebrow .live.done.ok .ld{background:var(--ok);}
@keyframes liveGlow{0%,100%{box-shadow:0 0 0 0 rgba(217,123,43,.55);opacity:1;}50%{box-shadow:0 0 0 6px rgba(217,123,43,0);opacity:.5;}}
.ctx-runstats{display:flex;align-items:baseline;gap:16px;font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:nowrap;}
.ctx-runstats b{color:var(--num);font-weight:600;font-size:16px;margin-right:3px;}
.theme-seg{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line);border-radius:999px;padding:3px;background:var(--card2);flex:none;}
.theme-seg button{border:none;background:transparent;color:var(--muted);font-family:var(--font-mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;padding:5px 12px;border-radius:999px;cursor:pointer;line-height:1;}
.theme-seg button.on{background:var(--honey);color:#3E261C;font-weight:600;}
.stage{flex:1;display:flex;flex-direction:column;min-height:0;}
.panel{display:none;}.panel.active{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;}
.doc{max-width:var(--content-wide);margin:0 auto;width:100%;padding:28px 30px 56px;}
.sechead{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px;margin:30px 0 18px;}
.sechead:first-child{margin-top:0;}
.sechead h2{font-size:23.5px;font-weight:600;letter-spacing:-.02em;}
.sechead .n{font-family:'Geist Mono',ui-monospace,monospace;color:var(--honey-link);font-size:14px;}
.sechead .meta{margin-left:auto;font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;color:var(--muted);}
.intro{color:var(--ink2);font-size:15.5px;max-width:760px;margin:-4px 0 4px;}
.card{background:var(--cream-card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:var(--card-shadow);}
.field{margin-bottom:13px;}
.field label{display:block;color:var(--muted);font-size:12px;font-family:'Geist Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;}
.field input,.field select,.field textarea{width:100%;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--espresso);padding:9px 11px;font-size:15px;}
.field input,.field select{height:40px;}
.field textarea{min-height:110px;font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;resize:vertical;}
.hint{color:var(--muted);font-size:12.5px;margin-top:8px;margin-bottom:12px;line-height:1.5;}

.sbadge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;font-family:'Geist Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;}
.sbadge.ok{color:var(--ok);background:var(--ok-soft);}.sbadge.warn{color:#7a4c00;background:#FBF0D9;}.sbadge.info{color:var(--honey-link);background:#FBF0D9;}.sbadge.err{color:#9f211d;background:#FBE6E3;}

.cbx{width:16px;height:16px;border-radius:5px;border:1px solid var(--line);background:#fff;flex:none;position:relative;}
.cbx.on{border-color:var(--honey-link);background:var(--honey);}
.cbx.on:after{content:"";position:absolute;width:7px;height:4px;border-left:2px solid var(--espresso);border-bottom:2px solid var(--espresso);transform:rotate(-45deg);left:3px;top:4px;}


.tbl-wrap{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--cream-card);}
table{width:100%;border-collapse:collapse;font-size:14px;}
thead th{text-align:left;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:500;padding:11px 14px;border-bottom:1px solid var(--line);background:var(--cream);}
tbody td{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--ink2);}tbody tr:last-child td{border-bottom:none;}
td.path{font-family:'Geist Mono',ui-monospace,monospace;color:var(--honey-link);word-break:break-all;}
.bizimpact{font-size:15px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-left:3px solid var(--honey);border-radius:10px;padding:13px 15px;}

/* ---- recommendation-audit panel: 2-col layout + pipeline stages ---- */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.pipeline{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}
.pstage{min-height:88px;border:1px solid var(--line);border-radius:12px;background:var(--cream-card);padding:12px;}
.pstage h3{font-size:14px;font-weight:600;}
.pstage p{margin-top:6px;color:var(--muted);font-size:12.5px;}
.pstage.done{border-color:#BFD8C6;}
.pstage.active{border-color:var(--honey-link);background:#FBF0D9;}
.log{background:var(--term-bg);color:#E7D8C8;border-radius:14px;padding:15px 17px;font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;overflow:auto;line-height:1.65;min-height:150px;max-height:300px;}
.log .t{color:#B9A38C;}
.log .err{color:#E8A89B;}
@media (max-width:900px){.grid2,.pipeline{grid-template-columns:1fr;}}

/* ---- connect: source cards + sticky detail panel ---- */
.src-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:22px;align-items:start;margin-top:4px;}
.src-list{display:flex;flex-direction:column;gap:10px;}
.src-card{width:100%;display:flex;align-items:center;gap:13px;text-align:left;border:1px solid var(--line);border-radius:13px;padding:14px 15px;background:var(--cream-card);cursor:pointer;color:inherit;box-shadow:var(--card-shadow);transition:border-color .14s,box-shadow .14s;}
.src-card:hover{border-color:var(--muted);}
.src-card.pick{border-color:var(--honey-link);box-shadow:0 0 0 1px var(--honey-link) inset;}
.src-mono{width:38px;height:38px;border-radius:10px;flex:none;display:flex;align-items:center;justify-content:center;font-family:'Geist Mono',ui-monospace,monospace;font-size:13.5px;font-weight:600;background:#FAF4EA;color:var(--honey-link);border:1px solid #EFE2CC;}
.src-card.on .src-mono{background:var(--espresso);color:#F3D9A8;border-color:var(--espresso);}
.src-body{flex:1;min-width:0;}
.src-name{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.src-line{display:block;color:var(--muted);font-size:13px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.detail-panel{border:1px solid var(--line);border-radius:14px;background:var(--cream-card);padding:18px;position:sticky;top:18px;}
.detail-kicker{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;}
.detail-title{font-size:18px;font-weight:600;margin-bottom:13px;}
.detail-body{color:var(--ink2);font-size:14px;line-height:1.55;margin-bottom:14px;}
@media (max-width:1100px){.src-grid{grid-template-columns:1fr;}.detail-panel{position:static;}}
/* ── Connect tab redesign: category-card grid + status summary + slide-over connect panel (light+dark via tokens) ── */
.cx-wrap{max-width:none;margin:0 auto;width:100%;}
.cx-intro{color:var(--ink2);font-size:15px;line-height:1.5;margin:0 0 12px;max-width:var(--prose-max,72ch);}
.cx-summary{display:flex;align-items:center;flex-wrap:wrap;gap:6px 0;border:1px solid var(--line);border-radius:13px;background:var(--cream-card);padding:14px 20px;margin-bottom:16px;box-shadow:var(--card-shadow);}
.cx-stat{display:flex;align-items:baseline;gap:9px;padding:0 24px;}
.cx-stat:first-child{padding-left:0;}
.cx-stat .n{font-family:'Geist Mono',ui-monospace,monospace;font-size:24.5px;font-weight:600;color:var(--num);line-height:1;}
.cx-stat .k{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.cx-sep{width:1px;height:26px;background:var(--line);}
.cx-ro{margin-left:auto;display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;background:var(--cream);padding:7px 13px;}
.cx-ro .d{width:7px;height:7px;border-radius:50%;background:var(--ok);}
.cx-ro .t{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--ink2);}
.cx-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start;}   /* minmax(0,…): a long nowrap row sub-line must ellipsize, never widen the column past the viewport */
.cx-card{border:1px solid var(--line);border-radius:13px;background:var(--cream-card);padding:2px 16px 10px;box-shadow:var(--card-shadow);min-width:0;overflow:hidden;}
.cx-card-head{display:flex;align-items:baseline;justify-content:space-between;padding:13px 2px 3px;}
.cx-card-head .lab{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--num);}
.cx-card-head .ct{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);}
.cx-row{width:100%;display:flex;align-items:center;gap:11px;padding:10px 16px;margin:0 -16px;border:none;border-top:1px solid var(--line);background:transparent;cursor:pointer;font-family:inherit;color:inherit;text-align:left;transition:background .12s;}
.cx-row:hover{background:var(--honey-soft);}
.cx-badge{width:28px;height:28px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;font-weight:600;border:1px solid var(--line);background:var(--card2);color:var(--muted);}
.cx-badge.connected{background:var(--ok-soft);color:var(--ok);}
.cx-badge.reconnect{background:var(--high-soft);color:var(--high);}
.cx-row-main{flex:1;min-width:0;}
.cx-row-name{display:block;font-size:14.5px;font-weight:600;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cx-row-sub{display:block;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cx-dot{width:7px;height:7px;border-radius:50%;flex:none;background:transparent;border:1.5px solid var(--muted);}
.cx-dot.connected{background:var(--ok);border-color:var(--ok);}
.cx-dot.reconnect{background:var(--high);border-color:var(--high);}
.cx-act{font-size:13px;font-weight:500;color:var(--num);flex:none;}
.cx-act.reconnect{color:var(--high);}
.cx-backdrop{position:fixed;inset:0;z-index:60;background:rgba(38,24,16,.34);}
/* Slide-over as a CARD aligned with the content block: starts below the topbar (top set in openConnPanel from the
   topbar's real height, so LIVE RUN stays visible) and ends near the bottom — spanning the same vertical band as the
   saved-org → coming-soon content, not the full viewport. */
.cx-panel{position:fixed;top:90px;right:18px;bottom:24px;z-index:61;width:min(430px,92vw);background:var(--cream-card);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 50px rgba(62,38,28,.22);display:flex;flex-direction:column;overflow:hidden;}
/* when the slide-over is open, reserve ONLY the panel's width (content keeps its normal max-width instead of
   getting squeezed to a narrow column) — wide screens only; on small screens the panel overlays. */
.panel[data-panel=connect] .doc{transition:padding-right .25s ease;}
@media (min-width:1100px){body.conn-panel-open .panel[data-panel=connect] .doc{max-width:none;padding-right:calc(min(430px,40vw) + 48px);}}
/* Where the page reserves room for the drawer (wide screens) there is no backdrop at all, so clicks reach the rows
   (clicking another row switches the drawer); on narrower screens, where the drawer overlays the page, the backdrop is
   a VISIBLE scrim and a click on it closes the drawer. Never an invisible click-swallowing layer. */
@media (min-width:1100px){body.conn-panel-open .cx-backdrop{display:none!important;}}
.cx-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px 14px;border-bottom:1px solid var(--line);}
.cx-panel-x{flex:none;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--cream);color:var(--muted);cursor:pointer;font-size:15px;line-height:1;}
.cx-panel-x:hover{color:var(--espresso);border-color:var(--muted);}
.cx-panel-body{flex:1;min-height:0;overflow-y:auto;padding:18px 22px 26px;}
@media (max-width:820px){.cx-grid{grid-template-columns:1fr;}}

.doc.run-doc{max-width:var(--content-wide);}
/* ---- run screen: filter head + horizontal run-card strip + centered detail ---- */
.run-screen{width:100%;max-width:var(--content-wide);margin:0 auto;}
.run-strip-head{display:flex;align-items:center;gap:12px;padding:16px 30px 10px;}
.run-search{position:relative;margin-left:auto;width:240px;}
.run-search input{height:36px;width:100%;border:1px solid var(--line);border-radius:9px;background:var(--cream-card);color:var(--espresso);font-size:13.5px;padding:0 10px 0 32px;}
.run-search svg{position:absolute;left:10px;top:9px;color:var(--muted);}
.run-filters{display:flex;align-items:center;gap:6px;}
/* Chips are the SAME fixed box in every state: border-box + inline-flex centering + line-height:1 so neither
   the active restyle nor button UA font metrics can change the rendered height (all four always 30px). */
.run-filter{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:30px;line-height:1;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:var(--cream-card);color:var(--muted);font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.run-filter.active{border-color:var(--num);background:var(--honey-soft);color:var(--num);}
.run-strip{display:flex;gap:10px;align-items:stretch;overflow-x:auto;overflow-y:hidden;padding:6px 30px 16px;}
.run-newcard{flex:none;width:154px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:5px;border:1.5px dashed var(--honey);border-radius:12px;background:var(--honey-tint);color:var(--honey-link);font-size:14px;font-weight:600;text-align:left;cursor:pointer;padding:12px 14px;}
.run-newcard:hover{background:var(--honey-soft);border-color:var(--honey-link);}
.run-newcard .plus{font-size:21.5px;line-height:1;}
/* min-height pins every strip tile — run/ask cards AND the dashed "New …" tile — to the same box in
   every filter state: an empty filter (no sibling cards to stretch to) no longer collapses the tile. */
.run-card{flex:none;width:210px;min-height:118px;display:flex;flex-direction:column;gap:0;border:1px solid var(--line);border-radius:12px;background:var(--cream-card);text-align:left;color:inherit;padding:12px 13px;cursor:pointer;box-shadow:var(--card-shadow);transition:border-color .14s,box-shadow .14s;}
.run-card:hover{border-color:var(--muted);}
.run-card.active{border-color:var(--num);box-shadow:0 0 0 1px var(--num) inset;}
.run-card-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.run-card-id{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;font-weight:400;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.run-card-title{display:block;margin-top:8px;font-size:14.5px;font-weight:600;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.run-card-title.lead{margin-top:0;margin-bottom:8px;}   /* polish: history cards lead with the run TITLE; the id is secondary */
.run-card-when{display:block;margin-top:7px;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.run-empty{color:var(--muted);font-size:14px;padding:16px;align-self:center;}

/* ---- runs: detail cards, vertical timeline, event stream, config ---- */
.run-detail-wrap{width:100%;padding:18px 30px 44px;}
.rf-arts{margin-top:12px;border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:7px;max-height:236px;overflow-y:auto;}
.rf-art{display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:1px solid var(--line);border-radius:10px;background:var(--cream);padding:9px 12px;cursor:pointer;color:inherit;font:inherit;}
.rf-art:hover{border-color:var(--muted);}
.rf-art .g{width:24px;height:24px;border-radius:6px;background:var(--honey-soft);color:var(--num);display:grid;place-items:center;flex:none;font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;}
.rf-art .nm{flex:1;min-width:0;}
.rf-art .nm b{font-size:14px;font-weight:600;display:block;color:var(--espresso);}
.rf-art .nm span{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);}
.rf-art .op{color:var(--num);font-weight:600;font-size:13px;flex:none;}
/* Report LIBRARY list (console redesign): artifact chips + title-row side actions */
.rf-chips{margin-top:11px;border-top:1px solid var(--line);padding-top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.rf-chip{display:inline-flex;align-items:center;gap:6px;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-radius:999px;padding:4px 10px;cursor:pointer;}
.rf-chip .g{color:var(--num);}
.rf-chip:hover{border-color:var(--muted);}
.rfolder{position:relative;}
/* Extract memory / Remove: a static pill IN the title row (always visible; the old hover-revealed
   absolute cluster covered the artifact chips at the card's bottom-right). */
.rf-title-acts{display:inline-flex;gap:2px;align-items:center;background:var(--cream);border:1px solid var(--line);border-radius:999px;padding:2px 8px;flex:none;}
.rf-act-sep{color:var(--muted);font-size:12px;flex:none;}
.rf-side-act{border:none;background:none;font:inherit;font-size:12px;color:var(--muted);cursor:pointer;padding:2px 4px;flex:none;white-space:nowrap;}
.rf-side-act:hover{color:var(--espresso);}
.rf-side-act[disabled]{color:var(--honey-link);cursor:default;}
.rfolder .run-title-pencil{opacity:0;transition:opacity .12s;}
.rfolder:hover .run-title-pencil{opacity:1;}
.run-right{min-width:0;}
.rd-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start;}
.rd-col{display:flex;flex-direction:column;gap:14px;min-width:0;}
.rd-stack{display:flex;flex-direction:column;gap:16px;}
.rd-card{border:1px solid var(--line);border-radius:14px;background:var(--cream-card);padding:18px;box-shadow:var(--card-shadow);}
.rd-card.flush{padding:0;overflow:hidden;}
.run-balance-grid{align-items:start;}
.run-side-col{min-width:0;}
.run-pipeline-card{display:flex;flex-direction:column;min-height:0;}
.run-pipeline-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;}
.run-pipeline-card.compact .run-pipeline-body{padding-top:10px;}
.run-pipeline-card.compact .g-tnode{padding:9px 11px;}
.run-pipeline-card.compact .g-vlink{height:8px;}
.run-pipeline-card.compact .g-flabel{margin:7px 0 5px;}
.run-pipeline-card.compact .g-rail{gap:6px;}
.run-pipeline-card.compact .g-lane2{padding:7px 9px;}
.run-pipeline-card.compact .g-lane2-steps{margin-top:6px;}
.run-pipeline-card.compact .g-lane2-sub{display:none;}
.run-pipeline-card.compact .g-tsub{line-height:1.35;}
.rd-head{display:flex;align-items:flex-start;gap:16px;}
.rd-id{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--muted);margin-bottom:6px;}
.rd-rename{background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;line-height:1;padding:0 3px;}.rd-rename:hover{color:var(--honey-link);}
.rd-uuid{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--muted);opacity:.7;margin:-3px 0 6px;}
.rd-title-row{display:flex;align-items:center;gap:10px;min-width:0;}
.rd-title{font-size:22.5px;font-weight:600;letter-spacing:-.02em;line-height:1.18;overflow:hidden;text-overflow:ellipsis;}
.rd-sub{font-size:14px;color:var(--ink2);margin-top:8px;overflow-wrap:anywhere;}
.rd-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:18px;}
.rd-metric{border-left:1px solid var(--line);padding-left:13px;min-width:0;}
.rd-metric .v{font-family:'Geist Mono',ui-monospace,monospace;font-size:18px;font-weight:600;color:var(--num);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rd-metric .v.txt{font-family:'Geist',system-ui,sans-serif;color:var(--espresso);letter-spacing:-.01em;}
.rd-metric .l{font-size:12px;color:var(--muted);margin-top:3px;}
.rd-brief{border-left:3px solid var(--honey);}
.rd-brief-lab{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--honey-link);margin-bottom:8px;}
.rd-brief-txt{font-size:14.5px;color:var(--ink2);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;}
.rd-brief-txt.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;max-height:6.4em;}
.rd-brief-more{margin-top:9px;background:none;border:none;color:var(--honey-link);font-size:13.5px;font-weight:600;cursor:pointer;padding:0;}
.rd-brief-more:hover{color:#7C540A;}
.mem-b{background:var(--cream-card);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-top:14px;}
.mem-b-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);}
.mem-b-head h3{font-size:15px;font-weight:600;}
.mem-b-glyph{width:26px;height:26px;border-radius:7px;background:var(--honey);color:var(--espresso);display:grid;place-items:center;flex:none;}
.mem-b-glyph svg{display:block;}
.mem-b-grid{display:grid;grid-template-columns:1.5fr 1fr;}
.mem-b-main{padding:18px;border-right:1px solid var(--line);}
.mem-b-side{padding:18px;background:#FBF7EF;}
.mem-b-ptn{font-size:17px;font-weight:600;letter-spacing:-.01em;margin:8px 0 14px;}
.mem-lab{font-size:13px;font-weight:600;color:var(--espresso);margin:0 0 8px;}
.mem-sig{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;}
.mem-pill{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-radius:999px;padding:3px 9px;}
.mem-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;}
.mem-checks li{display:flex;gap:8px;font-size:14px;color:var(--espresso);}
.mem-checks .mk{color:var(--honey-link);}
/* memory receipt: collapse next-run auto-checks to the first 3 behind a CSS-only See more/less toggle */
.mem-b .rc-rest-li{display:none;}
.mem-b .rc-tgl:checked ~ .mem-checks .rc-rest-li{display:flex;}
.mem-b .rc-more{display:inline-block;margin-top:9px;color:var(--honey-link);cursor:pointer;font-size:13.5px;font-weight:500;}
.mem-b .rc-more:hover{text-decoration:underline;}
.mem-b .rc-hide{display:none;}
.mem-b .rc-tgl:checked ~ .rc-show{display:none;}
.mem-b .rc-tgl:checked ~ .rc-hide{display:inline-block;}
.mem-receipt{display:flex;flex-direction:column;gap:12px;margin-top:12px;}
.mem-metric .n{font-family:'Geist Mono',ui-monospace,monospace;font-size:23.5px;font-weight:600;color:var(--espresso);font-variant-numeric:tabular-nums;line-height:1;}
.mem-metric .n.pos{color:#2f7d5b;}
.mem-metric .k{font-size:12.5px;color:var(--muted);margin-top:3px;}
.mem-priv{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink2);}
.mem-priv .ic{color:var(--honey-link);flex:none;line-height:0;}
.mem-priv .ic svg{display:block;}
@media(max-width:640px){.mem-b-grid{grid-template-columns:1fr;}.mem-b-main{border-right:0;border-bottom:1px solid var(--line);}}
.mem-term{background:var(--term-bg);color:#F3E9DA;padding:20px 22px;font-family:'Geist Mono',ui-monospace,monospace;font-size:14px;line-height:1.7;}
.mem-term .mt-h{color:var(--honey);font-weight:600;}
.mem-term .mt-block{margin-top:14px;}
.mem-term .mt-k{color:#B6A08C;}
.mem-term .mt-v{color:#F3E9DA;}
.mem-term .mt-li{color:#F3E9DA;}
.mem-term .mt-li .d{color:var(--honey);margin-right:6px;}
.mem-term .mt-ok{color:#7FD0A3;}
.mem-term .mt-tier{color:var(--honey);text-transform:uppercase;letter-spacing:.06em;font-size:12.5px;}
/* recognition card: collapse a long auto-check list to 2 lines with a CSS-only See more/less toggle */
.mem-term .rc-rest{display:none;}
.mem-term .rc-tgl:checked ~ .rc-rest{display:block;}
.mem-term .rc-more{display:inline-block;margin-top:9px;color:var(--honey);cursor:pointer;font-size:13.5px;}
.mem-term .rc-more:hover{text-decoration:underline;}
.mem-term .rc-hide{display:none;}
.mem-term .rc-tgl:checked ~ .rc-show{display:none;}
.mem-term .rc-tgl:checked ~ .rc-hide{display:inline-block;}
.mem-term .mt-more{color:var(--honey);cursor:pointer;margin-top:7px;font-size:13px;}
.mem-term .mt-more:hover{text-decoration:underline;}
.mem-tier3{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);}
/* ---- Org Memory tab (read-only browse) ---- */
/* ---- Memory tab redesign — deck-exact (console redesign) ---- */
.panel[data-panel=memory] .doc{max-width:var(--content-wide);padding:20px 30px 44px;}
.mem-wrap{max-width:none;margin:0 auto;width:100%;}
/* stats row: hairline dividers via gap:1px over a --line background (deck), not borders */
.mem-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:14px;box-shadow:var(--card-shadow);}
.mem-stat{background:var(--cream-card);padding:14px 16px;min-width:0;}
.mem-stat .n{font-family:'Geist Mono',ui-monospace,monospace;font-size:28px;font-weight:600;color:var(--num);line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mem-stat .k{font-size:12px;color:var(--muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mem-ver{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin:14px 2px 0;}   /* UI-14: the version is bookkeeping, not a headline stat */
.mem-stat .k.warn{color:var(--high-ink);}   /* --high as TEXT was 3.03:1 on cream */
@media (max-width:900px){.mem-stats{grid-template-columns:repeat(2,minmax(0,1fr));}}
.mem-grid{display:grid;grid-template-columns:minmax(0,1fr) 258px;gap:14px;align-items:start;}
@media (max-width:1100px){.mem-grid{grid-template-columns:1fr;}}
.mem-main-card{border:1px solid var(--line);border-radius:14px;background:var(--cream-card);overflow:hidden;box-shadow:var(--card-shadow);}
.mem-main-head{padding:6px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;}
.mem-tierwrap{position:relative;}
.mem-tierpill{display:inline-flex;align-items:center;gap:9px;background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:4px 10px;cursor:pointer;font-family:inherit;color:var(--espresso);}
.mem-tierpill .tl{font-size:15px;font-weight:600;}
.mem-tierpill .car{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--muted);}
.mem-tierveil{position:fixed;inset:0;z-index:40;}
.mem-tiermenu{position:absolute;top:calc(100% + 6px);left:0;z-index:41;min-width:244px;background:var(--cream-card);border:1px solid var(--line);border-radius:11px;box-shadow:0 16px 38px rgba(62,38,28,.24);overflow:hidden;}
.mem-tiermenu button{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--line);padding:10px 13px;cursor:pointer;font-family:inherit;color:var(--espresso);}
.mem-tiermenu button:last-child{border-bottom:none;}
.mem-tiermenu button:hover{background:var(--honey-tint);}
.mem-tiermenu .tick{width:12px;font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;color:var(--num);flex:none;}
.mem-tiermenu .lbl{flex:1;font-size:14px;font-weight:600;}
.mem-tiermenu .scope{font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);flex:none;}
.mem-head-org{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
/* Empty memory in the MAIN card: rich empty state (icon tile + copy + big 0) */

.mem-tier-empty{padding:34px 20px;text-align:center;}
.mem-tier-empty .glyph{width:44px;height:44px;border-radius:12px;background:var(--honey-soft);color:var(--num);display:grid;place-items:center;margin:0 auto 14px;font-family:'Geist Mono',ui-monospace,monospace;font-size:20.5px;}
.mem-tier-empty .t{font-size:16px;font-weight:600;margin-bottom:7px;color:var(--espresso);}
.mem-tier-empty p{font-size:14px;color:var(--muted);line-height:1.6;max-width:46ch;margin:0 auto;}
.mem-tier-empty .big{font-family:'Geist Mono',ui-monospace,monospace;font-size:25.5px;font-weight:600;color:var(--num);margin-top:18px;line-height:1;}
.mem-tier-empty .sub{font-size:12px;color:var(--muted);margin-top:4px;}
.mem-bytype{border:1px solid var(--line);border-radius:14px;background:var(--cream-card);padding:14px 16px;box-shadow:var(--card-shadow);}
.mem-bytype .bt-lab{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;}
.mem-bt-list{display:flex;flex-direction:column;gap:11px;}
.mem-bt-top{display:flex;justify-content:space-between;font-size:13px;color:var(--ink2);margin-bottom:4px;}
.mem-bt-name{text-transform:capitalize;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mem-bt-n{color:var(--num);font-family:'Geist Mono',ui-monospace,monospace;font-weight:700;}
.mem-bt-bar{display:block;height:7px;border-radius:5px;background:var(--card2);overflow:hidden;}
.mem-bt-fill{display:block;height:7px;border-radius:5px;background:var(--honey);}
.mem-tiers-card{border:1px solid var(--line);border-radius:14px;background:var(--cream-card);padding:14px 16px;}
.mem-tiers-card .tr-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.mem-tiers-card .tr-row h3{font-size:14px;font-weight:600;color:var(--espresso);margin:0;}
.mem-tiers-card .tr-n{font-family:'Geist Mono',ui-monospace,monospace;font-size:16px;font-weight:600;color:var(--num);}
.mem-tiers-card .tr-sub{color:var(--muted);font-size:12.5px;margin-top:3px;}
.mem-tiers-card .tr-div{margin-top:13px;padding-top:13px;border-top:1px solid var(--line);}
/* card rows: 3px colored left rail by state (green active · orange disputed · muted retired/superseded) */
.mem-card.st-ok{border-left:3px solid var(--ok);}
.mem-card.st-warn{border-left:3px solid var(--high);}
.mem-card.st-dim{border-left:3px solid var(--muted);}
.mem-card-type{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--num);flex:none;white-space:nowrap;}
.mem-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:11px;}
.mem-chip{border:1px solid var(--line);border-radius:999px;background:var(--cream-card);color:var(--espresso);padding:5px 12px;font-size:13px;cursor:pointer;text-transform:capitalize;transition:background .13s,border-color .13s;}
.mem-chip:hover{border-color:var(--honey);}
.mem-chip.on{background:#3E261C;color:#fff;border-color:#3E261C;}
.mem-chip-n{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;opacity:.7;margin-left:4px;}
.mem-search{margin-bottom:12px;}
.mem-search input{width:100%;height:38px;border:1px solid var(--line);border-radius:9px;background:var(--card2);color:var(--espresso);padding:8px 12px;font-size:14.5px;}
.mem-list{max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:9px;}
.mem-card{border:1px solid var(--line);border-radius:11px;background:var(--cream-card);overflow:hidden;flex:none;}
.mem-card-head{display:flex;align-items:center;gap:11px;padding:11px 14px;cursor:pointer;}
.mem-card-head .mt-tier{color:var(--honey-link);text-transform:uppercase;letter-spacing:.06em;font-size:12px;font-family:'Geist Mono',ui-monospace,monospace;white-space:nowrap;flex:none;}
.mem-card-desc{flex:1;font-size:14.5px;color:var(--espresso);min-width:0;}
.mem-card-caret{font-family:'Geist Mono',ui-monospace,monospace;font-size:15px;color:var(--muted);flex:none;}
.mem-card-repos{display:flex;flex-wrap:wrap;gap:5px;padding:0 14px 10px 14px;}
.mem-repo{border:1px solid var(--line);border-radius:999px;background:var(--honey-soft);color:var(--num);padding:2px 8px;font-size:10.5px;font-family:'Geist Mono',ui-monospace,monospace;}
.mem-card-body{padding:0 14px 13px;font-size:14px;line-height:1.6;color:var(--muted);white-space:pre-wrap;border-top:1px solid var(--line);padding-top:11px;}
.mem-empty{padding:20px 4px;color:var(--muted);font-size:14px;text-align:center;}
.mem-full-body{white-space:pre-wrap;font-size:14px;line-height:1.6;color:var(--ink2);}
.mem-sec{margin-top:12px;}
.mem-sec-lbl{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--honey-link);margin-bottom:5px;}
.mem-prov{font-size:13px;color:var(--muted);line-height:1.55;}
.mem-prov b{color:var(--ink2);font-weight:600;}
.mem-links{display:flex;flex-direction:column;gap:4px;}
.mem-link{font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;color:var(--ink2);word-break:break-all;}
.mem-link .mem-link-rel{color:var(--honey-link);text-transform:uppercase;letter-spacing:.05em;margin-right:6px;}
.mem-chipset{display:flex;flex-wrap:wrap;gap:6px;}
.mem-ent{border:1px solid var(--line);border-radius:999px;background:var(--card2);color:var(--ink2);padding:3px 9px;font-size:12px;font-family:'Geist Mono',ui-monospace,monospace;}
.mem-foot{margin-top:13px;padding-top:10px;border-top:1px solid var(--line);font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.mem-body-actions{margin-top:13px;display:flex;gap:8px;}
.mem-edit-lbl{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:12px 0 5px;font-weight:600;}
.mem-edit-in{width:100%;box-sizing:border-box;padding:8px 11px;border:1px solid var(--line);border-radius:9px;background:var(--cream-card);font-size:14px;color:var(--espresso);font-family:inherit;}
.mem-edit-in:focus{outline:none;border-color:var(--espresso);}
textarea.mem-edit-in{min-height:130px;resize:vertical;line-height:1.55;}
.mem-edit-row{display:flex;gap:10px;flex-wrap:wrap;}
.mem-edit-row>div{flex:1;min-width:150px;}
.mem-danger{color:#C0392B;font-size:13.5px;line-height:1.5;font-weight:600;margin-top:9px;}
.mem-dlg-err{color:#C0392B;font-size:13px;margin-top:10px;}
/* ---- Org Memory tab: Cards|History sub-tab toggle + change timeline ---- */
.mem-subtab{display:inline-flex;gap:0;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--cream-card);}
.mem-subtab button{border:none;background:transparent;color:var(--muted);padding:6px 15px;font-size:13.5px;cursor:pointer;font-family:inherit;transition:background .13s,color .13s;}
.mem-subtab button:hover{color:var(--espresso);}
.mem-subtab button.on{background:#3E261C;color:#fff;}
.cmp-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.cmp-top .cmp-kinds{flex:1 1 auto;min-width:0;}
.cmp-search-box{margin-left:auto;flex:0 1 260px;min-width:180px;margin-bottom:11px;}
.cmp-search{width:100%;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--cream-card);color:var(--espresso);padding:6px 11px;font:inherit;font-size:14px;}
.cmp-search:focus{outline:none;box-shadow:var(--focus-ring);}
.cmp-single{font-size:14px;line-height:1.5;color:var(--ink2);background:var(--honey-soft);border:1px solid var(--line);border-radius:10px;padding:9px 13px;margin:4px 0 10px;max-width:var(--prose-max);}
.cmp-intro{font-size:14px;line-height:1.55;color:var(--muted);margin:4px 0 10px;max-width:var(--prose-max);}
.cmp-legend{background:#FDF1DC;color:#8A5A00;border-radius:4px;padding:0 5px;}
.cmp-stats{font-size:12.5px;color:var(--muted);margin:0 0 8px;}
.cmp-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--cream-card);max-width:100%;}
.cmp-table{border-collapse:collapse;width:100%;font-size:13.5px;}
.cmp-table th,.cmp-table td{border-bottom:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top;}
.cmp-table th{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:600;white-space:nowrap;}
.cmp-table td.cmp-key{min-width:170px;}
.cmp-k{font-size:13px;color:var(--espresso);word-break:break-all;}
.cmp-kind,.cmp-meta,.cmp-alias{font-size:12px;color:var(--muted);margin-top:3px;}
.cmp-neutral{font-size:12px;color:var(--muted);margin-top:3px;font-style:italic;}
.cmp-differs{font-size:12px;color:#8A5A00;font-weight:600;margin-top:4px;}
.cmp-cell{min-width:180px;max-width:320px;}
.cmp-div{background:#FDF1DC;}
.cmp-stale .cmp-sum{opacity:.7;}
.cmp-state{font-size:12px;color:#8A5A00;margin-top:3px;}
.cmp-restricted,.cmp-restricted-h{color:var(--muted);font-style:italic;}
.cmp-none{color:var(--muted);}
.cmp-evs{display:flex;flex-direction:column;gap:2px;margin-top:5px;}
.cmp-ev{font-size:12px;color:var(--honey-link);word-break:break-all;text-decoration:none;}
a.cmp-ev:hover{text-decoration:underline;}
.cmp-empty{margin-top:10px;color:var(--ink2);line-height:1.6;}
.cmp-aliases{margin-top:12px;font-size:13px;color:var(--muted);}
[data-theme=dark] .cmp-div{background:rgba(214,158,46,.16);}
[data-theme=dark] .cmp-legend{background:rgba(214,158,46,.22);color:#F2C572;}
[data-theme=dark] .cmp-differs,[data-theme=dark] .cmp-state{color:#F2C572;}
.mem-hist{max-height:560px;overflow:auto;display:flex;flex-direction:column;}
.mem-hist-day{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--line);}
.mem-hist-day:first-child{margin-top:2px;}
.mem-ev{display:flex;align-items:flex-start;gap:11px;padding:9px 2px;border-bottom:1px solid var(--line);}
.mem-ev:last-child{border-bottom:none;}
.mem-ev-time{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--muted);white-space:nowrap;flex:none;min-width:78px;padding-top:2px;}
.mem-ev-main{flex:1;min-width:0;}
.mem-ev-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;}
.mem-ev-chip{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;background:var(--card2);color:var(--ink2);padding:2px 9px;flex:none;}
.mem-ev-act{font-size:13px;font-weight:600;}
/* run-page Memory card: collapsed shows 3 rows; expanded scrolls internally instead of growing the page */
.mem-hist-scroll{max-height:300px;overflow-y:auto;}
.mem-ev-more{display:block;width:100%;margin-top:6px;border:none;border-top:1px dashed var(--line);background:none;font-family:inherit;font-size:13px;font-weight:600;color:var(--honey-link);cursor:pointer;padding:9px 0 2px;text-align:center;}
.mem-ev-more:hover{color:var(--espresso);}
.mem-ev-act.add{color:var(--honey-link);}
.mem-ev-act.reinforce{color:var(--muted);}
.mem-ev-act.retire{color:#C0392B;}
.mem-ev-act.edit{color:var(--ink2);}
.mem-ev-card{font-size:14px;color:var(--espresso);line-height:1.5;word-break:break-word;}
.mem-ev-run{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:3px;}
.mem-ev-runlink{color:var(--honey-link);text-decoration:underline;text-underline-offset:2px;}
/* History rows are expandable to the full card (reusing the Cards edit/delete flow). */
.mem-ev-row{display:flex;align-items:flex-start;gap:10px;}
.mem-ev-body-main{flex:1;min-width:0;}
.mem-ev-cardid{font-size:11px;}
.mem-ev-type{flex:none;}
.mem-ev-caret{padding-top:1px;}
.mem-ev-revert{align-self:flex-start;}
.mem-ev-row[role=button]:hover .mem-ev-caret{color:var(--honey-link);}
.mem-ev-body{margin-top:9px;padding:11px 0 2px;border-top:1px solid var(--line);white-space:normal;}
/* QuickAsk memory: read-only "recognized" (no ledger write). Terminal footnote colour + report-folder card. */
.mem-term .mt-ro{color:#8f7a68;}
.rec-card{background:var(--cream-card);border:1px solid var(--line);border-radius:14px;padding:17px 19px;margin-top:14px;box-shadow:var(--card-shadow);}
.rec-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:11px;}
.rec-ptn{font-size:17px;font-weight:600;letter-spacing:-.01em;margin:6px 0 0;}
.rec-ro{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);background:#F5F0E6;border:1px solid var(--line);border-radius:999px;padding:3px 10px;white-space:nowrap;flex:none;}
.rec-ro svg{display:block;flex:none;}
.rec-checks{font-size:14px;color:var(--ink2);line-height:1.55;margin-top:2px;}
.rec-checks .rc-lab{color:var(--muted);font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;display:block;margin-bottom:6px;}
/* each auto-check on its OWN line, wrapping long text instead of running off-screen (was white-space:nowrap on one row) */
.rec-checks .rc-chk{display:block;padding-left:15px;text-indent:-15px;margin:3px 0;}
.rec-checks .d{color:var(--honey-link);}
/* CSS-only See more/less: show first 2, collapse the rest behind a checkbox-hack toggle */
.rec-checks .rc-rest{display:none;}
.rec-checks .rc-tgl:checked ~ .rc-rest{display:block;}
.rec-checks .rc-more{display:inline-block;margin-top:8px;color:var(--honey-link);cursor:pointer;font-size:13.5px;font-weight:500;}
.rec-checks .rc-more:hover{text-decoration:underline;}
.rec-checks .rc-hide{display:none;}
.rec-checks .rc-tgl:checked ~ .rc-show{display:none;}
.rec-checks .rc-tgl:checked ~ .rc-hide{display:inline-block;}
.rec-foot{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.rec-note{font-size:13px;color:var(--muted);max-width:36ch;}
.rec-cta{white-space:nowrap;}
/* QuickAsk run page: taller VERTICAL pipeline (fills the left column beside the terminal + memory card) */
.pipe-v{display:flex;flex-direction:column;padding:2px 2px 0;}
.pv-stage{display:flex;gap:13px;align-items:flex-start;}
.pv-rail{display:flex;flex-direction:column;align-items:center;align-self:stretch;}
.pv-dot{width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;font-weight:700;}
.pv-dot.done{background:#DCF0E4;color:#0b6845;border:1px solid #9FCBAE;}
.pv-dot.running{background:var(--honey);color:var(--espresso);border:1px solid #C98E1E;box-shadow:0 0 0 4px rgba(254,194,64,.28);animation:tlPulse 1.7s ease-in-out infinite;}
.pv-dot.wait{background:var(--track);color:var(--muted);border:1px solid var(--line);}
.pv-line{width:2px;flex:1;background:var(--line);margin:4px 0;min-height:38px;}
.pv-body{padding-bottom:24px;min-width:0;}
.pv-body:last-child{padding-bottom:0;}
.pv-body h3{font-size:15px;font-weight:600;margin:4px 0 3px;}
.pv-body p{margin:0 0 9px;color:var(--muted);font-size:13px;}
.pv-sub{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;}
.pv-sub li{font-size:12.5px;color:var(--ink2);font-family:'Geist Mono',ui-monospace,monospace;display:flex;gap:7px;}
.pv-sub .d{color:var(--honey-link);}
.rd-sec-head{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;}
.rd-sec-head h3{font-size:15px;font-weight:600;}
.rd-sec-head .eyebrow{font-size:11px;}
.tl{padding:12px 16px 16px;}
@keyframes tlPulse{0%,100%{box-shadow:0 0 0 4px rgba(254,194,64,.28);}50%{box-shadow:0 0 0 7px rgba(254,194,64,.10);}}
/* ---- branching pipeline graph ---- */
.graph{display:flex;flex-direction:column;align-items:stretch;}
.g-dot{width:22px;height:22px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;font-weight:700;background:var(--cream);color:var(--muted);border:1.5px solid var(--line);transition:transform .15s,box-shadow .2s;}
.g-dot.sm{width:18px;height:18px;font-size:9.5px;}
.g-dot.done{background:#DCF0E4;color:#0b6845;border-color:#9FCBAE;}
.g-dot.running{background:var(--honey);color:var(--espresso);border-color:#C98E1E;box-shadow:0 0 0 4px rgba(254,194,64,.28);transform:scale(1.08);animation:tlPulse 1.7s ease-in-out infinite;}
.g-dot.failed{background:#FBE6E3;color:#9f211d;border-color:#E8B5AE;}
.g-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}
.g-chip{font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-radius:6px;padding:2px 7px;white-space:nowrap;}
/* node card (root + converge nodes) */
.g-node{border:1px solid var(--line);border-radius:12px;background:var(--cream-card);padding:11px 13px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;}
.g-node:hover{border-color:var(--muted);}
.g-node.running{border-color:var(--honey);background:linear-gradient(180deg,#FFF8E6,#FFFDF6);box-shadow:0 0 0 1px var(--honey) inset,0 2px 10px rgba(254,194,64,.18);}
.g-node.done{border-color:#BFD8C6;}
.g-node.failed{border-color:#E8B5AE;background:#FDF1EF;}
.g-node.selected{border-color:var(--espresso);box-shadow:0 0 0 2px var(--espresso) inset;}
.g-node-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.g-name{font-size:14.5px;font-weight:600;}
.g-node.running .g-name{color:var(--honey-link);}
.g-kind{font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.04em;color:var(--honey-link);background:#FBF0D9;border:1px solid #F0DCAE;border-radius:999px;padding:2px 8px;text-transform:lowercase;}
.g-meta{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--muted);margin-left:auto;}
.g-desc{font-size:12.5px;color:var(--ink2);margin-top:5px;line-height:1.5;}
.g-root{max-width:560px;margin:0 auto;width:100%;box-sizing:border-box;}
.g-rootwrap{display:flex;flex-direction:column;align-items:center;}
.g-bundles{max-width:560px;width:100%;box-sizing:border-box;margin:8px auto 0;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 11px;border:1px dashed #E0D3BE;border-radius:10px;background:var(--cream);}
.g-bundles-lab{font-family:'Geist Mono',ui-monospace,monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--honey-link);}
.g-bundle{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;color:var(--muted);background:var(--cream-card);border:1px solid var(--line);border-radius:6px;padding:2px 8px;opacity:.55;}
.g-bundle.on{color:var(--espresso);background:#FBF0D9;border-color:#F0DCAE;opacity:1;font-weight:600;}
.g-bundles-note{flex-basis:100%;font-size:10.5px;color:var(--muted);font-style:italic;}
/* fan-out / fan-in connectors */
.g-fan{display:block;width:100%;height:40px;}
.g-fan path{fill:none;stroke:var(--line);stroke-width:1.5;}
/* lane grid */
.g-lanes-scroll{overflow-x:auto;padding-bottom:2px;}
.g-lanes-pending{border:1px dashed var(--line);border-radius:12px;background:var(--cream);padding:18px 14px;text-align:center;color:var(--muted);font-size:13.5px;font-style:italic;margin:4px 0;}
.g-lanes{display:grid;gap:10px;min-width:0;}
.g-lane{border:1px solid var(--line);border-radius:12px;background:var(--cream);padding:9px;display:flex;flex-direction:column;gap:0;min-width:0;transition:border-color .15s,box-shadow .15s;}
.g-lane.active{border-color:var(--honey);box-shadow:0 0 0 1px var(--honey) inset;}
.g-lane-hd{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--espresso);padding:2px 2px 7px;}
.g-lane-dot{width:7px;height:7px;border-radius:50%;background:var(--honey);flex:none;box-shadow:0 0 0 2px #FBF0D9;}
.g-lane-link{width:2px;height:9px;background:var(--line);margin:0 auto;}
.g-lnode{border:1px solid var(--line);border-radius:9px;background:var(--cream-card);padding:7px 8px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;}
.g-lnode:hover{border-color:var(--muted);}
.g-lnode.running{border-color:var(--honey);background:linear-gradient(180deg,#FFF8E6,#FFFDF6);box-shadow:0 0 0 1px var(--honey) inset;}
.g-lnode.done{border-color:#BFD8C6;}
.g-lnode.failed{border-color:#E8B5AE;background:#FDF1EF;}
.g-lnode.selected{border-color:var(--espresso);box-shadow:0 0 0 2px var(--espresso) inset;}
.g-lnode-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.g-lrole{font-size:13px;font-weight:600;}
.g-lnode.running .g-lrole{color:var(--honey-link);}
.g-lkind{font-family:'Geist Mono',ui-monospace,monospace;font-size:8.5px;letter-spacing:.03em;color:var(--muted);text-transform:lowercase;}
.g-lchips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}
.g-lchips .g-chip{font-size:9px;padding:1px 6px;}
/* converge column */
.g-converge{max-width:560px;width:100%;box-sizing:border-box;margin:0 auto;display:flex;flex-direction:column;align-items:stretch;}
.g-reports{width:100%;box-sizing:border-box;margin:0 auto;}
.g-vlink{width:2px;height:12px;background:var(--line);margin:0 auto;}
/* ---- rebuilt vertical node tree (Pipeline graph) ---- */
.g-tnode{display:flex;align-items:center;gap:11px;border:1px solid var(--line);border-radius:12px;background:var(--cream-card);padding:11px 13px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;}
.g-tnode:hover{border-color:var(--muted);}
.g-tnode.running{border-color:var(--honey);background:var(--honey-tint);box-shadow:0 0 0 1px var(--honey) inset;}
.g-tnode.done{border-color:var(--ok-soft);}
.g-tnode.failed{border-color:var(--crit);}
.g-tnode.selected{border-color:var(--espresso);box-shadow:0 0 0 2px var(--espresso) inset;}
.g-tnode.hi{background:var(--honey-soft);border-color:var(--num);}
.g-tnode.queued .g-sq{background:transparent;border-color:var(--line);color:var(--muted);}
.g-tbody{flex:1;min-width:0;}
.g-ttitle{font-size:14.5px;font-weight:600;color:var(--espresso);}
.g-tnode.running .g-ttitle{color:var(--honey-link);}
.g-tsub{font-size:12.5px;color:var(--ink2);margin-top:3px;line-height:1.5;}
.g-tag{font-family:var(--font-mono);font-size:10px;letter-spacing:.04em;color:var(--num);margin-left:auto;flex:none;text-transform:lowercase;}
.g-sq{width:22px;height:22px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;background:var(--honey);color:#3E261C;font-family:var(--font-mono);font-size:12px;font-weight:700;}
.g-sq.sm{width:12px;height:12px;border-radius:4px;box-shadow:0 0 0 2px var(--honey-soft);}
.g-flabel{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--num);margin:9px 0 7px;}
.g-rail{border-left:2px solid var(--ok);margin-left:11px;padding-left:16px;display:flex;flex-direction:column;gap:8px;}
.g-lane2{position:relative;border:1px solid var(--line);border-radius:10px;background:var(--cream-card);padding:8px 10px;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;}
.g-lane2::before{content:'';position:absolute;left:-16px;top:16px;width:14px;height:2px;background:var(--ok);}
.g-lane2:hover{border-color:var(--muted);}
.g-lane2.active{border-color:var(--honey);background:var(--honey-tint);box-shadow:0 0 0 1px var(--honey) inset;}
/* collapsed fan-out: the "⋯ N more bundles" expander row between the first two lanes and the last */
.g-lane2.g-lane-more{border-style:dashed;background:transparent;text-align:center;font-family:var(--font-mono);font-size:12px;color:var(--muted);padding:7px 10px;}
.g-lane2.g-lane-more b{color:var(--num);}
.g-lane2.g-lane-more:hover{color:var(--espresso);border-color:var(--muted);background:var(--cream-card);}
.g-lane2-hd{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap;row-gap:4px;}
.g-lane2-nm{font-size:13px;font-weight:600;color:var(--espresso);}
.g-lane2-ct{margin-left:auto;flex:none;font-family:var(--font-mono);font-size:10px;color:var(--num);}
.g-lane2-steps{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:7px;}
.g-lane2-sub{font-family:var(--font-mono);font-size:10px;color:var(--muted);line-height:1.5;margin-top:7px;}
.g-arrow{font-family:var(--font-mono);font-size:9.5px;color:var(--muted);}
.g-step{font-family:var(--font-mono);font-size:9px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-radius:6px;padding:2px 7px;white-space:nowrap;cursor:pointer;transition:border-color .15s,background .15s,color .15s;}
.g-step:hover{border-color:var(--muted);}
.g-step.running{border-color:var(--honey);background:var(--honey-tint);color:var(--num);}
.g-step.done{border-color:var(--ok-soft);color:var(--ok);}
.g-step.failed{border-color:var(--crit);color:var(--crit);}
.g-step.selected{border-color:var(--espresso);box-shadow:0 0 0 1px var(--espresso) inset;}
.g-inchip{font-family:var(--font-mono);font-size:10.5px;color:var(--num);border:1px solid var(--line);border-radius:6px;padding:1px 6px;cursor:pointer;white-space:nowrap;}
.g-inchip:hover{border-color:var(--muted);}
.g-inchip.selected{border-color:var(--espresso);}
/* graph + side detail panel layout */
/* node detail POP-UP modal — floats above everything, incl. the sticky topbar */
.nodemodal{position:fixed;inset:0;z-index:200;background:rgba(42,26,18,.46);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:24px;animation:nmFade .14s ease-out;}
.nodemodal[hidden]{display:none;}
@keyframes nmFade{from{opacity:0;}to{opacity:1;}}
.nm-card{width:560px;max-width:92vw;max-height:84vh;display:flex;flex-direction:column;background:var(--cream-card);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 64px rgba(42,26,18,.34);overflow:hidden;animation:nmPop .16s ease-out;}
@keyframes nmPop{from{transform:translateY(8px) scale(.985);opacity:.6;}to{transform:none;opacity:1;}}
.nm-head{display:flex;align-items:flex-start;gap:12px;padding:15px 16px;border-bottom:1px solid var(--line);background:var(--cream);}
.nm-kicker{font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--honey-link);}
.nm-title{font-size:17px;font-weight:600;margin-top:3px;}
.nm-sub{font-size:12px;color:var(--muted);margin-top:5px;line-height:1.45;}
.nm-x{flex:none;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--cream-card);color:var(--muted);font-size:20.5px;line-height:1;cursor:pointer;transition:border-color .14s,color .14s,background .14s;}
.nm-x:hover{border-color:var(--espresso);color:var(--espresso);background:var(--cream);}
.nm-body{padding:14px 16px;overflow-y:auto;}
.exp-lbl{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;font-weight:600;}
.exp-in{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--cream-card);font-size:14px;color:var(--espresso);font-family:inherit;}
.exp-in:focus{outline:none;border-color:var(--espresso);}
.np-note{font-size:12.5px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-left:3px solid var(--honey);border-radius:8px;padding:9px 11px;line-height:1.5;}
.np-row{margin-bottom:11px;}
.np-lab{display:block;font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;}
.np-val{font-size:14px;color:var(--espresso);font-weight:500;}
.np-chips{display:flex;flex-wrap:wrap;gap:5px;}
.np-count{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--honey-link);margin-bottom:9px;}
.np-item{border:1px solid var(--line);border-radius:9px;background:var(--cream);padding:9px 10px;margin-bottom:8px;}
.np-item-h{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px;}
.np-idx{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;font-weight:700;color:var(--honey-link);background:#FBF0D9;border-radius:5px;padding:1px 6px;flex:none;}
.np-item-t{font-size:13px;font-weight:600;line-height:1.4;min-width:0;}
.np-metric{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;color:var(--espresso);}
.np-value{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-left:auto;}
.np-lkind{font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;color:var(--muted);}
.np-dispo{font-family:'Geist Mono',ui-monospace,monospace;font-size:9px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;border-radius:999px;padding:2px 8px;border:1px solid transparent;}
.np-dispo.dispo-bad{color:#9f211d;background:#FBE6E3;border-color:#E8B5AE;}
.np-dispo.dispo-good{color:#0b6845;background:#DCF0E4;border-color:#BFD8C6;}
.np-dispo.dispo-eval{color:#7a4c00;background:#FBF0D9;border-color:#F0DCAE;}
.np-ev{font-size:12px;color:var(--ink2);line-height:1.5;overflow-wrap:anywhere;}
.np-ev-lab{font-family:'Geist Mono',ui-monospace,monospace;font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);}
.np-check{font-size:12px;color:var(--ink2);line-height:1.5;margin-top:5px;overflow-wrap:anywhere;}
.np-res{font-size:12px;color:var(--espresso);line-height:1.5;margin-top:6px;background:#FCF7EE;border-radius:7px;padding:6px 8px;overflow-wrap:anywhere;}
.np-bottom{margin:0;padding-left:18px;}
.np-bottom li{font-size:13px;color:var(--ink2);line-height:1.55;margin-bottom:9px;}
.np-more{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;color:var(--honey-link);text-align:center;padding:4px;letter-spacing:.05em;}
.ev-stream{background:var(--term-bg);max-height:300px;min-height:220px;overflow-y:auto;font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;line-height:1.6;}
.ev-row{display:grid;grid-template-columns:42px 68px 92px minmax(0,1fr);gap:9px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.06);}
.ev-idx{color:#9C7F66;}.ev-ts{color:#8FA0AE;font-variant-numeric:tabular-nums;}.ev-stage{font-weight:600;color:var(--honey);}.ev-msg{color:#E7D8C8;overflow-wrap:anywhere;}
.ev-row.verify .ev-stage{color:#A8DFBF;}.ev-row.tool .ev-stage{color:#9FC2F5;}.ev-row.error .ev-stage{color:#E8A89B;}
.ev-row.nostage{grid-template-columns:42px 68px minmax(0,1fr);}
.ev-filter{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-radius:999px;padding:3px 10px;cursor:pointer;}
.ev-filter.on{background:var(--honey-soft);border-color:var(--honey-link);color:var(--espresso);}
.ev-head-r{display:flex;align-items:center;gap:10px;}  /* ask-run rows: idx · time · msg (no stage column) */
.ev-empty{padding:16px 14px;color:#9C7F66;}
.rd-outs{padding:12px 16px;display:flex;flex-direction:column;gap:8px;max-height:352px;overflow-y:auto;}
.rd-outs.ck-scroll{max-height:288px;}   /* checkpoints: show ~3, scroll the rest */
.rd-out{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:10px;background:var(--cream);padding:11px 13px;}
.rd-out strong{font-size:13.5px;}.rd-out span.s{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--muted);}
.rd-out-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
.rd-empty{border:1px dashed #D8CEBE;border-radius:14px;background:var(--cream-card);padding:50px 30px;text-align:center;color:var(--muted);font-size:15px;}
/* ---- checkpoint / resume ---- */
.sbadge.pub{color:var(--honey-link);background:transparent;border:1px solid currentColor;}   /* UI-18: "published" is not a run status — never the COMPLETE green */
.sbadge.cache{color:var(--ok);background:rgba(47,125,84,.07);border:1px dashed #7FB596;}
[data-theme=dark] .sbadge.cache{background:rgba(93,190,139,.08);border-color:#4E7F63;}
.lineage-chip{display:inline-flex;align-items:center;gap:6px;border:1px dashed #7FB596;border-radius:999px;background:rgba(47,125,84,.07);color:var(--ok);font-family:var(--font-mono);font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;white-space:nowrap;}
.lineage-chip:hover{border-style:solid;}
[data-theme=dark] .lineage-chip{border-color:#4E7F63;background:rgba(93,190,139,.08);}
.rd-ckline{margin-top:10px;font-family:var(--font-mono);font-size:12.5px;color:var(--honey-link);}
.rd-metric .n{font-size:10.5px;color:var(--ok);font-family:var(--font-mono);margin-top:2px;}
.g-node,.g-lnode,.g-tnode{position:relative;}
.g-ckpt{position:absolute;top:-7px;right:10px;font-size:12px;color:#3E261C;background:var(--honey);border-radius:999px;padding:0 7px;line-height:15px;height:15px;font-family:var(--font-mono);font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.25);pointer-events:none;z-index:1;}
.g-node.cached,.g-lnode.cached,.g-tnode.cached,.g-lane2.cached{border-color:#7FB596;border-style:dashed;background:rgba(47,125,84,.07);}
[data-theme=dark] .g-node.cached,[data-theme=dark] .g-lnode.cached,[data-theme=dark] .g-tnode.cached,[data-theme=dark] .g-lane2.cached{border-color:#4E7F63;background:rgba(93,190,139,.08);}
.g-step.cached{color:var(--ok);border-color:#7FB596;border-style:dashed;background:rgba(47,125,84,.07);}
[data-theme=dark] .g-step.cached{border-color:#4E7F63;background:rgba(93,190,139,.08);}
.g-tnode.hi.cached{background:rgba(47,125,84,.07);border-color:#7FB596;}
[data-theme=dark] .g-tnode.hi.cached{background:rgba(93,190,139,.08);border-color:#4E7F63;}
.g-dot.cached{background:rgba(47,125,84,.10);color:var(--ok);border-color:#7FB596;border-style:dashed;}
.g-chip.cache{color:var(--ok);border-color:#7FB596;border-style:dashed;background:rgba(47,125,84,.07);}
.g-lane.cached{border-color:#7FB596;border-style:dashed;}
.g-lane-tag{white-space:nowrap;flex:none;margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--ok);border:1px dashed #7FB596;border-radius:6px;padding:1px 6px;background:rgba(47,125,84,.07);}
.g-lane2.delta{border-color:#C9A227;border-style:dashed;background:rgba(201,162,39,.07);}
[data-theme=dark] .g-lane2.delta{border-color:#8F7A2E;background:rgba(222,185,80,.08);}
.g-lane-tag.delta{color:#8A6D00;border-color:#C9A227;background:rgba(201,162,39,.08);}
[data-theme=dark] .g-lane-tag.delta{color:#E3C766;border-color:#8F7A2E;}
.g-lane-tag.rerun{color:var(--muted);border-style:solid;border-color:var(--line);background:transparent;}
.ev-row.reused .ev-stage{color:#7FB596;}
.ev-row.reused .ev-msg{color:#9DBBA8;}
.ck-row{display:flex;align-items:center;gap:11px;border:1px solid var(--line);border-radius:10px;background:var(--cream);padding:10px 13px;}
.ck-row.latest{border-color:var(--honey);background:var(--honey-tint);box-shadow:0 0 0 1px var(--honey) inset;}
.ck-dia{font-size:14px;color:var(--honey-link);flex:none;width:16px;text-align:center;}
.ck-main{flex:1;min-width:0;}
.ck-name{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.ck-name .latest-tag{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--honey-link);}
.ck-name .sbadge{padding:2px 8px;font-size:9.5px;}
.ck-sub{font-family:var(--font-mono);font-size:10.5px;color:var(--muted);margin-top:4px;line-height:1.5;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;word-break:break-word;}  /* UI-12: a long Comprehend summary clamps to 2 lines; the full text is the title tooltip */
.ck-meta{font-family:var(--font-mono);font-size:10px;color:var(--muted);margin-top:3px;}
.resume-banner{border-left:3px solid var(--honey);background:var(--honey-tint);border-radius:0 10px 10px 0;padding:11px 14px;margin-bottom:14px;}
.resume-banner .t{font-size:14px;font-weight:600;}
.resume-banner .s{font-family:var(--font-mono);font-size:11px;color:var(--honey-link);margin-top:3px;}
.radio{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--line);flex:none;position:relative;background:var(--cream-card);}
.cfg-item.sel{background:var(--honey-tint);box-shadow:0 0 0 1px var(--honey) inset;}
.cfg-item.sel .radio{border-color:var(--honey-link);}
.cfg-item.sel .radio:after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--honey);}
.cfg-item.disabled{opacity:.45;cursor:not-allowed;}
.pin-row{display:flex;align-items:baseline;gap:10px;padding:4px 0;font-size:13.5px;}
.pin-row .k{font-family:var(--font-mono);font-size:10.5px;color:var(--muted);width:86px;flex:none;text-transform:uppercase;letter-spacing:.05em;}
.pin-row .v{color:var(--ink2);min-width:0;}
.rc-row{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;background:var(--cream);padding:9px 12px;margin-bottom:7px;}
.rc-main{flex:1;min-width:0;}
.rc-n{font-size:13.5px;font-weight:600;}
.rc-s{font-family:var(--font-mono);font-size:10.5px;color:var(--muted);margin-top:2px;}
.rc-ok{color:var(--ok);font-family:var(--font-mono);font-size:12px;font-weight:600;white-space:nowrap;}
.rc-warn{color:var(--high);font-family:var(--font-mono);font-size:12px;font-weight:600;white-space:nowrap;}
.cost-note{display:block;font-size:13px;color:var(--ink2);border:1px dashed #7FB596;background:rgba(47,125,84,.07);border-radius:10px;padding:9px 12px;margin:14px 0 12px;line-height:1.55;}
[data-theme=dark] .cost-note{border-color:#4E7F63;background:rgba(93,190,139,.08);}
.cfg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.cfg-title{font-size:17px;font-weight:600;}
.cfg-cancel{background:none;border:1px solid var(--line);border-radius:8px;padding:5px 11px;font-size:13px;color:var(--muted);cursor:pointer;}
.cfg-intro{color:var(--ink2);font-size:14px;margin-bottom:15px;}
.cfg-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.cfg-toggle{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;background:var(--cream);border:1px solid var(--line);border-radius:8px;padding:4px 10px;cursor:pointer;color:var(--espresso);}
.cfg-list{border:1px solid var(--line);border-radius:11px;background:var(--cream);padding:6px;margin-bottom:15px;max-height:300px;overflow:auto;}
.cfg-search{width:100%;box-sizing:border-box;font:14px/1.4 'Geist',ui-sans-serif,sans-serif;color:var(--espresso);background:var(--cream);border:1px solid var(--line);border-radius:9px;padding:8px 11px;margin-bottom:8px;}
.cfg-search:focus{outline:none;border-color:var(--honey-link);}
.cfg-nomatch{padding:12px 10px;color:var(--muted);font-size:14px;}
.cfg-group{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--honey-link);padding:9px 8px 4px;}
.cfg-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;}
.cfg-item:hover{background:var(--cream-card);}
.cfg-lbl{flex:1;font-size:14px;}
.cfg-sub{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--muted);}
.cfg-brief{width:100%;resize:vertical;font:14px/1.55 'Geist',ui-sans-serif,sans-serif;color:var(--espresso);background:var(--cream);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:15px;box-sizing:border-box;flex:0 0 auto;min-height:140px;max-height:360px;}
.cfg-eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--num);margin-right:10px;}
.cfg-head-l{display:flex;align-items:baseline;gap:2px;flex-wrap:wrap;}
.cfg-lab{display:block;margin-bottom:6px;}
.cfg-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:4px;align-items:start;}   /* columns size to their own content — the brief no longer stretches to the bundle list's height */
.cfg-col{min-width:0;display:flex;flex-direction:column;}
.cfg-scope{width:100%;box-sizing:border-box;font:14px/1.4 'Geist',ui-sans-serif,sans-serif;color:var(--espresso);background:var(--cream);border:1px solid var(--line);border-radius:9px;padding:9px 11px;}
.cfg-scope:focus,.cfg-brief:focus{outline:none;border-color:var(--honey-link);}
.cfg-brief.mono{font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;line-height:1.5;flex:1;margin-bottom:0;}
.cfg-chips{display:flex;flex-wrap:wrap;gap:8px;}
.cfg-chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:var(--cream);color:var(--espresso);}
.cfg-chip.on{background:var(--honey-soft);border-color:var(--num);}
.cfg-chip .chk{color:var(--ok);font-weight:700;}
.cfg-chip-sub{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);}
.cfg-chip-empty{font-size:13.5px;color:var(--muted);}
.cfg-chip.btn-chip{cursor:pointer;user-select:none;}
.cfg-chip.btn-chip:hover{border-color:var(--num);}
.cfg-chip .cfg-caret{font-size:9.5px;color:var(--muted);margin-left:1px;}
.cfg-srcdd{position:relative;display:inline-block;}
.cfg-srcdd-panel{display:block;margin-top:8px;}
.cfg-srcdd-pop{position:static;min-width:236px;max-width:420px;background:var(--cream-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--card-shadow);padding:8px;}
.cfg-srcdd-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 6px 8px;border-bottom:1px solid var(--line);margin-bottom:6px;}
.cfg-srcdd-hd b{font-size:13px;color:var(--espresso);}
.cfg-srcdd-all{font-size:12px;color:var(--honey-link);cursor:pointer;background:none;border:0;padding:0;font:inherit;font-size:12px;}
.cfg-srcdd-all:hover{text-decoration:underline;}
.cfg-srcdd-search{width:100%;box-sizing:border-box;margin:2px 0 6px;font-size:12.5px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--cream);color:var(--espresso);outline:none;}
.cfg-srcdd-search:focus{border-color:var(--honey-link);}
.cfg-srcdd-search::placeholder{color:var(--muted);}
.cfg-srcdd-list{max-height:238px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;}
.cfg-srcdd-row{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;}
.cfg-srcdd-row:hover{background:var(--honey-tint);}
.cfg-srcdd-row .cbx{margin-top:1px;}
.cfg-srcdd-lbl{font-size:13px;color:var(--espresso);line-height:1.35;}
.cfg-srcdd-sub{display:block;font-size:11px;color:var(--muted);font-family:'Geist Mono',ui-monospace,monospace;}
.cfg-radio{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border:1px solid var(--line);border-radius:11px;background:var(--cream);cursor:pointer;margin-bottom:8px;}
.cfg-radio.on{border-color:var(--num);background:var(--honey-soft);}
.cfg-radio-dot{width:16px;height:16px;border-radius:50%;border:1px solid var(--line);flex:none;margin-top:2px;position:relative;background:var(--cream-card);}
.cfg-radio.on .cfg-radio-dot{border-color:var(--num);}
.cfg-radio.on .cfg-radio-dot:after{content:"";position:absolute;width:8px;height:8px;border-radius:50%;background:var(--honey);left:3px;top:3px;}
.cfg-radio-txt{display:flex;flex-direction:column;gap:2px;font-size:14px;color:var(--espresso);}
.cfg-radio-sub{font-size:12.5px;color:var(--muted);font-weight:400;}
.cfg-bunwrap{margin-top:2px;margin-bottom:0;}
.cfg-bun-hd{display:flex;justify-content:flex-end;margin-top:8px;}
@media(max-width:640px){.cfg-grid{grid-template-columns:1fr;}}
@media (max-width:1100px){.rd-grid{grid-template-columns:1fr;}.rd-metrics{grid-template-columns:repeat(2,1fr);}}

.reportwrap{flex:1;min-height:0;display:flex;}#reportFrame{flex:1;width:100%;border:none;background:#FAF8F4;}
.report-toggle{display:flex;align-items:center;gap:6px;padding:8px 30px;border-bottom:1px solid var(--line);background:var(--cream-card);flex:none;}
.report-toggle button{white-space:nowrap;flex:none;height:30px;border:1px solid var(--line);background:var(--cream-card);color:var(--muted);border-radius:8px;padding:0 13px;font:inherit;font-size:13.5px;cursor:pointer;}
.report-toggle button:hover{border-color:var(--muted);color:var(--espresso);}
.report-toggle button.on{background:var(--espresso);color:#fff;border-color:var(--espresso);}
.report-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);gap:14px;text-align:center;padding:40px;}
#reportList{width:100%;}
.report-art-card{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:14px;padding:11px 14px;margin-bottom:8px;background:var(--cream-card);box-shadow:var(--card-shadow);}
.report-art-icon{width:26px;height:26px;border-radius:7px;background:var(--honey-soft);color:var(--num);display:grid;place-items:center;flex:none;font-family:var(--font-mono);font-size:13px;font-weight:700;}

/* == CSS:REPORT == */
/* Open Report reading room: the reader bar, then a row of report TABS (console polish — the deck's left rail is gone, so
   the report iframe gets the full width): one tab per report of the run (Leadership / Execution for a Full Scan), the
   recommended one badged "Start here", read time as small mono text; REMEDIATION.md / trace / audit as compact links at
   the end. The strip scrolls sideways on a phone instead of wrapping. Only a single-view Quick Ask has no tabs. */
.report-tabs{flex:none;display:flex;align-items:flex-end;gap:12px;padding:0 30px;border-bottom:1px solid var(--line);background:var(--cream-card);min-width:0;}
.rtabs-list{display:flex;align-items:flex-end;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;flex:1 1 auto;}
.rtabs-list::-webkit-scrollbar{display:none;}
.rtab{display:inline-flex;align-items:center;gap:8px;flex:none;white-space:nowrap;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font:inherit;font-size:14.5px;font-weight:500;padding:10px 12px 9px;cursor:pointer;margin-bottom:-1px;}
.rtab:hover{color:var(--espresso);}
.rtab.on{color:var(--espresso);font-weight:600;border-bottom-color:var(--honey);}
.rtab:focus-visible{outline:none;box-shadow:var(--focus-ring);border-radius:6px;}
.rtab-min{font-size:12px;color:var(--muted);font-weight:400;}
.rtab-rec{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--num);border:1px solid var(--num);border-radius:999px;padding:1px 6px;font-weight:500;}
.rtabs-also{display:flex;align-items:center;gap:6px;flex:none;padding:6px 0;}
.rtab-also{font:inherit;font-size:12.5px;color:var(--num);font-weight:600;text-decoration:none;white-space:nowrap;border:1px solid var(--line);border-radius:8px;padding:4px 10px;background:transparent;cursor:pointer;}
.rtab-also:hover{border-color:var(--muted);}
.reportwrap{flex-direction:column;}
.report-pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;}
/* Labelled loading state over the report pane while the iframe loads */
.report-pane{position:relative;}
.report-loading{position:absolute;inset:0;z-index:2;background:var(--cream);padding:28px 32px;display:flex;flex-direction:column;gap:12px;}
.report-loading[hidden]{display:none;}
.report-loading .rl-lab{font-size:14px;font-weight:600;color:var(--ink2);}
.report-loading .rl-sk{height:14px;border-radius:7px;background:linear-gradient(90deg,var(--card2),var(--line),var(--card2));background-size:200% 100%;animation:rlShimmer 1.4s linear infinite;}
.report-loading .rl-sk.h{height:30px;width:55%;}
.report-loading .rl-sk.b{height:120px;}
@keyframes rlShimmer{from{background-position:200% 0;}to{background-position:-200% 0;}}
@media (prefers-reduced-motion:reduce){.report-loading .rl-sk{animation:none;}}
.report-toggle .rt-newtab{flex:none;font-size:12.5px;color:var(--num);font-weight:600;text-decoration:none;white-space:nowrap;border:1px solid var(--line);border-radius:8px;padding:4px 10px;}
.report-toggle .rt-newtab:hover{border-color:var(--muted);}
/* reader top bar — deck reading bar: back + kind pill + title + id·time (the view switch is the tab row below it) */
.report-toggle .rt-pill{white-space:nowrap;flex:none;display:inline-flex;align-items:center;font-family:var(--font-mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--num);border:1px solid var(--line);border-radius:999px;padding:2px 8px;background:transparent;}
/* console polish: at the larger type the reader bar must not wrap its button / pill / labels — the title and the id·time
   meta ellipsize instead (full text in the tooltip); phones keep the wrapping layout below */
.report-toggle .rt-title{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--espresso);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.report-toggle .rt-kind{font-size:12.5px;color:var(--muted);white-space:nowrap;flex:none;}
.report-toggle .rt-meta{font-size:12px;color:var(--muted);margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@media (max-width:760px){
  /* polish: the hidden-scrollbar tab row hints that it scrolls — a soft shadow on the right edge while more tabs sit
     off-screen (CSS-only scroll shadow: the 'local' cover scrolls with the content and hides the shadow at the end) */
  .report-tabs{padding:0 12px;gap:8px;overflow-x:auto;scrollbar-width:none;
    background:linear-gradient(to left,var(--cream-card) 45%,rgba(0,0,0,0)) right center/34px 100% no-repeat local,
               linear-gradient(to left,rgba(62,38,28,.22),rgba(62,38,28,0)) right center/18px 100% no-repeat scroll,
               var(--cream-card);}
  .report-tabs::-webkit-scrollbar{display:none;}
  .rtabs-list{overflow:visible;}
}


/* ── "Report Assistant" chat drawer (grounded in the open report) ── */
.cdfab{position:fixed;right:22px;bottom:22px;z-index:50;display:flex;align-items:center;gap:8px;background:var(--espresso);color:#FBF6EC;border:none;border-radius:24px;padding:11px 17px;font-size:14px;font-weight:500;cursor:pointer;box-shadow:0 6px 22px rgba(62,38,28,.28);}
.cdfab:hover{background:var(--espresso-hover);}
.cdfab .dot{width:7px;height:7px;border-radius:50%;background:var(--honey);}
.cd{position:fixed;top:0;right:0;height:100vh;width:var(--cd-width,440px);max-width:94vw;background:var(--cream);border-left:1px solid var(--line);box-shadow:-10px 0 40px rgba(62,38,28,.16);display:flex;flex-direction:column;z-index:60;transform:translateX(102%);transition:transform .2s ease;}
.cd.open{transform:translateX(0);}
/* drag-resize: grab the drawer's left edge → resize the drawer. It OVERLAYS the page (no body padding) — the old
   padding-right squeezed the run page until the event stream wrapped one character per line. */
.cd-resize{position:absolute;left:0;top:0;width:8px;height:100%;cursor:col-resize;z-index:3;}
.cd-resize:hover{background:linear-gradient(90deg,rgba(154,106,14,.32),transparent);}
body.cd-dragging,body.cd-dragging .cd{transition:none;}
.cd-head{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--cream-card);}
.cd-head .av{width:26px;height:26px;border-radius:7px;background:#FBF1D8;display:flex;align-items:center;justify-content:center;font-size:16px;overflow:hidden;}
.cd-head .ti{font-size:15px;font-weight:600;color:var(--espresso);line-height:1.15;}
.cd-head .sub{font-size:10.5px;color:var(--muted);}
.cd-ic{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:3px 6px;border-radius:6px;}
.cd-ic:hover{background:var(--cream);color:var(--espresso);}
.cd-chip{display:flex;align-items:center;gap:6px;background:#FBF1D8;border:1px solid var(--line);border-radius:14px;padding:3px 10px;font-size:12px;color:var(--honey-link);margin:9px 14px 0;}
.cd-chip b{color:var(--espresso);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;}
.cd-chip button{background:none;border:none;color:var(--honey-link);cursor:pointer;font-size:14px;padding:0;line-height:1;margin-left:auto;}
.cd-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:11px;}
.cd-msg{max-width:92%;font-size:14px;line-height:1.55;}
.cd-msg.user{align-self:flex-end;background:var(--espresso);color:#FBF6EC;border-radius:13px 13px 4px 13px;padding:8px 12px;white-space:pre-wrap;}
.cd-msg.asst{align-self:flex-start;color:var(--espresso);}
.cd-msg.asst .b{background:var(--cream-card);border:1px solid var(--line);border-radius:13px 13px 13px 4px;padding:9px 13px;}
.cd-msg.asst .b p{margin:0 0 7px;}.cd-msg.asst .b p:last-child{margin:0;}
.cd-msg.asst .b ul{margin:4px 0;padding-left:18px;}.cd-msg.asst .b code{background:#FBF1D8;padding:1px 4px;border-radius:4px;font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;}
.cd-msg.asst .b .cd-h{font-weight:600;font-size:14px;margin:8px 0 3px;}
.cd-msg.asst .b table.cd-tbl{border-collapse:collapse;width:100%;margin:6px 0;font-size:12.5px;}
.cd-msg.asst .b .cd-tbl th,.cd-msg.asst .b .cd-tbl td{border:1px solid var(--line);padding:4px 7px;text-align:left;vertical-align:top;}
.cd-msg.asst .b .cd-tbl th{background:#FBF1D8;font-weight:600;}
.cd-msg .meta{font-size:10.5px;color:var(--muted);margin-top:4px;}
.cd-sugg{display:flex;flex-direction:column;gap:7px;}
.cd-sugg .h{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;}
.cd-sugg button{text-align:left;background:var(--cream-card);border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:13.5px;color:var(--espresso);cursor:pointer;}
.cd-sugg button:hover{border-color:var(--honey-link);}
.cd-status{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:7px;}
.cd-foot{border-top:1px solid var(--line);padding:11px 12px;background:var(--cream-card);}
.cd-inrow{display:flex;gap:8px;align-items:flex-end;}
.cd-in{flex:1;min-height:38px;max-height:160px;resize:none;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;background:var(--cream);color:var(--espresso);}
.cd-send{background:var(--espresso);color:#FBF6EC;border:none;border-radius:10px;padding:9px 15px;font-size:14px;font-weight:500;cursor:pointer;}
.cd-send.stop{background:#9D4B3E;}.cd-send:disabled{opacity:.45;cursor:default;}
.cd-err{color:#C0392B;font-size:13px;}
.cd-list{border-bottom:1px solid var(--line);max-height:42%;overflow-y:auto;background:var(--cream-card);}
.cd-list .row{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--line);font-size:13.5px;}
.cd-list .row.on{background:#FBF1D8;}
.cd-list .row .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--espresso);cursor:pointer;}
.cd-mp{display:flex;gap:4px;margin-left:auto;}
.cd-mp button{background:none;border:1px solid var(--line);border-radius:6px;font-size:11px;padding:3px 7px;cursor:pointer;color:var(--muted);}
.cd-mp button.on{background:var(--espresso);color:#FBF6EC;border-color:var(--espresso);}
.cd-spin{width:11px;height:11px;border:2px solid var(--line);border-top-color:var(--honey-link);border-radius:50%;display:inline-block;animation:cdspin .7s linear infinite;}
@keyframes cdspin{to{transform:rotate(360deg);}}

/* ---- mobile: collapse the sidebar to an icon-only rail ----
   Placed at the end of the sheet so these single-class overrides win the
   source-order cascade over the base .ctx-topbar/.doc rules above. */
@media (max-width:720px){
  .sidebar{width:58px;padding:14px 6px;}
  .side-brand{justify-content:center;padding:6px 0 14px;}
  .side-brand .nm,.side-brand .eb{display:none;}
  .side-cta{font-size:0;padding:11px 0;gap:0;}
  .side-eyebrow{display:none;}
  .navitem{justify-content:center;gap:0;padding:11px 0;}
  .navitem .lbl{display:none;}
  .navitem .glyph{width:auto;font-size:16px;opacity:1;}
  .navitem .bar{left:-6px;top:7px;bottom:7px;}
  .side-foot{padding-top:12px;}
  .side-status{justify-content:center;font-size:0;padding:0 0 12px;}
  .ctx-topbar{padding:12px 16px;gap:10px;}
  .doc{padding:20px 16px 44px;}
  /* console polish: the Full Scan / Quick Ask status pills + search pushed the panel ~150px past a 390px screen — the
     head wraps, the pills scroll sideways, the search takes the full row */
  .run-strip-head{flex-wrap:wrap;padding:12px 16px 8px;}
  .run-filters{max-width:100%;overflow-x:auto;scrollbar-width:none;}
  .run-filters::-webkit-scrollbar{display:none;}
  .run-filters .run-filter{flex:none;}
  .run-search{margin-left:0;width:100%;}
  /* console polish: the Memory sub-tabs fit a 390px screen at the larger type (the 4th, "Add", was clipped) */
  .mem-subtab button{padding:6px 11px;}
}

/* ==== DECK-REDESIGN per-tab CSS (disjoint append regions; keep sentinels) ==== */
/* == CSS:CHOOSER == */
.nc-overlay{position:fixed;inset:0;z-index:220;background:rgba(42,26,18,.46);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:24px;}
.nc-overlay[hidden]{display:none;}
.nc-card{width:520px;max-width:92vw;background:var(--cream-card);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 64px rgba(42,26,18,.34);overflow:hidden;padding:20px 22px;}
.nc-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;}
.nc-kicker{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--num);}
.nc-title{font-size:20.5px;font-weight:600;letter-spacing:-.02em;margin:6px 0 0;color:var(--espresso);}
.nc-x{flex:none;width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--cream-card);color:var(--muted);cursor:pointer;font-family:inherit;}
.nc-x:hover{color:var(--espresso);border-color:var(--espresso);}
.nc-opt{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1px solid var(--line);border-radius:13px;background:var(--cream-card);padding:15px 16px;cursor:pointer;font-family:inherit;color:var(--espresso);margin-bottom:10px;transition:border-color .13s,background .13s;}
.nc-opt:hover{border-color:var(--num);background:var(--honey-soft);}
.nc-opt.scan{border-color:var(--num);background:var(--honey-soft);}
.nc-ico{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-family:var(--font-mono);font-weight:600;flex:none;}
.nc-ico.ask{background:var(--honey-soft);color:var(--num);font-size:20.5px;}
.nc-ico.scan{background:var(--honey);color:#3E261C;font-size:19.5px;}
.nc-opt-t{font-size:16px;font-weight:600;}
.nc-opt-d{font-size:13px;color:var(--ink2);margin:3px 0 6px;line-height:1.45;}
.nc-opt-m{font-family:var(--font-mono);font-size:10px;color:var(--muted);}
.nc-opt-m.num{color:var(--num);}
.nc-arrow{color:var(--num);font-size:17px;flex:none;}
.nc-foot{font-family:var(--font-mono);font-size:10.5px;color:var(--muted);margin-top:13px;text-align:center;}
/* == CSS:QUICKASK == */
/* Compose form: honey-tinted native checkboxes match the deck's filled honey squares (read-only-safe, purely visual). */
.ask-compose-checks input[type=checkbox]{accent-color:var(--honey);width:15px;height:15px;cursor:pointer;}
/* Post-ask "wrote learnings to memory" surface — the deck's honey-soft recognition strip + a detail card beneath it. */
.ask-mem-adds{margin-top:14px;}
.ask-mem-banner{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:12px;background:var(--honey-soft);padding:12px 16px;flex-wrap:wrap;}
.ask-mem-banner .amb-glyph{width:28px;height:28px;border-radius:8px;background:var(--honey);color:var(--espresso);display:grid;place-items:center;font-family:var(--font-mono);font-weight:700;flex:none;}
.ask-mem-banner .amb-body{min-width:0;flex:1;}
.ask-mem-banner .amb-title{font-size:14px;font-weight:600;color:var(--espresso);line-height:1.3;}
.ask-mem-banner .amb-title b{color:var(--num);font-weight:700;}
.ask-mem-banner .amb-sub{font-family:var(--font-mono);font-size:11px;color:var(--ink2);margin-top:3px;}
.ask-mem-banner .btn{margin-left:auto;flex:none;}
/* Quick Ask result HERO (deck): scope eyebrow · big question · intake · action row. */
.ask-hero-row{display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap;}
.ask-hero-main{flex:1;min-width:220px;}
.ask-hero-side{flex:none;display:flex;align-items:center;gap:6px;}
.ask-hero-eyebrow{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--num);}
.ask-hero-eyebrow .rd-rename{opacity:1;}
.ask-hero-title{font-size:22.5px;font-weight:600;letter-spacing:-.02em;margin:7px 0 0;line-height:1.15;color:var(--espresso);}
.ask-hero-q{font-size:13.5px;color:var(--ink2);line-height:1.55;margin:8px 0 0;text-wrap:pretty;}
.ask-hero-sub{font-family:var(--font-mono);font-size:10.5px;color:var(--muted);margin:8px 0 0;}
.ask-hero-acts{display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;}
.ask-hero-cost{margin-left:auto;font-family:var(--font-mono);font-size:12px;color:var(--muted);}
.ask-hero-cost b{color:var(--num);font-weight:600;}
/* == CSS:FULLSCAN == */
/* Deck alignment for the Full Scan tab. Appended after the FULLSCAN sentinel only; all colors ride the
   shared tokens so light + dark both track the deck. */
/* Run-history strip: a dashed honey "New full scan" tile leads the strip (deck). */
.ask-empty-hint{align-self:center;max-width:440px;margin-left:6px;font-size:13.5px;line-height:1.5;color:var(--muted);white-space:normal;}
.run-card-new{width:154px;flex-direction:column;justify-content:center;align-items:flex-start;gap:5px;border:1px dashed var(--num);background:var(--honey-soft);color:var(--num);box-shadow:none;}
.run-card-new:hover{border-color:var(--num);background:var(--card2);}
.run-card-new .rcn-plus{font-size:20.5px;font-weight:600;line-height:1;}
.run-card-new .rcn-lbl{font-size:13.5px;font-weight:600;}
/* Deck proportions: a narrow pipeline-graph column beside a wide event-stream / checkpoints column. */
@media (min-width:1101px){.panel[data-panel=run] .run-balance-grid{grid-template-columns:minmax(0,352px) minmax(0,1fr);}}
/* Terminal "Combined report" node under the Reports node (Normalizer's reconcile→merge output). */
.g-combined{display:flex;align-items:center;gap:9px;flex-wrap:wrap;border:1px solid var(--line);border-radius:10px;background:var(--cream-card);padding:9px 12px;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s,background .15s;}
.g-combined:hover{border-color:var(--muted);}
.g-combined.selected{border-color:var(--espresso);box-shadow:0 0 0 2px var(--espresso) inset;}
.g-combined.cached{border-color:#7FB596;border-style:dashed;background:rgba(47,125,84,.07);}
[data-theme=dark] .g-combined.cached{border-color:#4E7F63;background:rgba(93,190,139,.08);}
.g-combined-nm{font-size:13px;font-weight:600;color:var(--espresso);}
.g-combined-tag{font-family:var(--font-mono);font-size:8.5px;color:var(--num);background:var(--honey-soft);border:1px solid var(--line);border-radius:999px;padding:2px 7px;}
/* Full Scan run-detail HERO (deck): scope eyebrow · big title + status · brief · sources/checkpoint lines,
   a big findings numeral on the right, then an action row (Open report / Resume / est. cost). Parallels
   the Quick Ask ask-hero-* set; all colors ride the shared tokens so light + dark track the deck. */
.scan-hero-row{display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap;}
.scan-hero-main{flex:1;min-width:220px;}
.scan-hero-eyebrow{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--num);}
.scan-hero-eyebrow .rd-rename{opacity:1;}
.scan-hero-titlerow{display:flex;align-items:center;gap:10px;margin:7px 0 0;flex-wrap:wrap;}
.scan-hero-title{font-size:22.5px;font-weight:600;letter-spacing:-.02em;line-height:1.15;margin:0;color:var(--espresso);}
.scan-hero-brief{font-size:13.5px;color:var(--ink2);line-height:1.55;margin:8px 0 0;text-wrap:pretty;max-width:var(--prose-max);}
.scan-hero-brief.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.scan-hero-more{display:inline-block;margin-top:4px;background:none;border:none;padding:0;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--honey-link);cursor:pointer;}
.scan-hero-line{font-family:var(--font-mono);font-size:10.5px;color:var(--muted);margin:8px 0 0;}
.scan-hero-side{text-align:right;flex:none;}
.scan-hero-num{font-family:var(--font-mono);font-size:34px;font-weight:600;color:var(--num);line-height:1;}
.scan-hero-numlbl{font-size:12px;color:var(--muted);margin-top:4px;}
.scan-hero-acts{display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;}
.scan-hero-cost{margin-left:auto;font-family:var(--font-mono);font-size:12px;color:var(--muted);}
.scan-hero-cost b{color:var(--num);font-weight:600;}
/* Visualization row (deck: Code intelligence + Design & evolution). Cards render ONLY for artifacts the run
   really produced (see renderRunDetail) — no fabricated figures; a present card links to the real report. */
.scan-viz-row{display:grid;gap:14px;align-items:stretch;margin-top:14px;}
.scan-viz-card{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 16px;box-shadow:var(--card-shadow);display:flex;flex-direction:column;}
.scan-viz-head{display:flex;align-items:center;gap:7px;margin-bottom:10px;}
.scan-viz-eyebrow{font-family:var(--font-mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--num);}
.scan-viz-tag{margin-left:auto;font-family:var(--font-mono);font-size:9.5px;color:var(--muted);}
.scan-viz-body{font-size:13.5px;color:var(--ink2);line-height:1.55;text-wrap:pretty;flex:1;}
.scan-viz-card .btn{margin-top:12px;align-self:flex-start;}
/* Reusable method learned (deck): honey glyph header · pattern · signature chips · merge-count footer + Open Memory. */
.scan-learned{border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden;box-shadow:var(--card-shadow);margin-top:14px;}
.scan-learned-head{display:flex;align-items:center;gap:11px;padding:14px 16px;}
.scan-learned-glyph{width:26px;height:26px;border-radius:7px;background:var(--honey);color:#3E261C;display:grid;place-items:center;font-family:var(--font-mono);font-weight:700;flex:none;}
.scan-learned-title{font-size:15px;font-weight:600;color:var(--espresso);}
.scan-learned-tag{margin-left:auto;font-family:var(--font-mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);}
.scan-learned-body{padding:0 16px 16px;}
.scan-learned-pattern{font-size:16px;font-weight:600;letter-spacing:-.01em;margin-bottom:11px;color:var(--espresso);}
.scan-learned-chips{display:flex;gap:7px;flex-wrap:wrap;}
.scan-sig{font-family:var(--font-mono);font-size:11px;color:var(--ink2);background:var(--honey-soft);border:1px solid var(--line);border-radius:999px;padding:4px 11px;}
.scan-learned-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:14px;padding-top:14px;}
.scan-learned-count{font-family:var(--font-mono);font-size:12.5px;color:var(--ink2);}
.scan-learned-count b{color:var(--num);font-weight:600;}
.scan-learned-foot .btn{margin-left:auto;}
/* Run output as a chip grid (deck): one chip per REAL artifact, each carrying its existing open/export action. */
.scan-out{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 16px;box-shadow:var(--card-shadow);margin-top:14px;}
.scan-out-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.scan-out-eyebrow{font-family:var(--font-mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);}
.scan-out-count{margin-left:auto;font-family:var(--font-mono);font-size:9.5px;color:var(--muted);}
.scan-out-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
.scan-chip{display:block;width:100%;box-sizing:border-box;text-align:left;text-decoration:none;border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:6px 10px;font-family:var(--font-mono);font-size:11px;color:var(--ink2);cursor:pointer;transition:border-color .13s,background .13s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.scan-chip:hover{border-color:var(--muted);background:var(--card2);}
.scan-chip.primary{border-color:var(--num);background:var(--honey-soft);color:var(--num);font-weight:600;}
.scan-out-pub{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
/* "Start here": one recommended entry, then the rest, each with an audience + read-time line */
.scan-guide-rec{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;border:1px solid var(--num);background:var(--honey-soft);border-radius:10px;padding:10px 14px;margin-bottom:8px;cursor:pointer;font:inherit;color:inherit;}
.scan-guide-rec .sg-tag{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--num);border:1px solid var(--num);border-radius:999px;padding:2px 8px;flex:none;}
.scan-guide-rec .sg-nm{font-size:15px;font-weight:600;color:var(--num);}
.scan-guide-rec .sg-ln{font-size:12.5px;color:var(--ink2);}
.scan-guide-rec .sg-go{margin-left:auto;font-size:13px;font-weight:600;color:var(--num);flex:none;}
.scan-chip .sc-ln{display:block;font-size:10.5px;color:var(--muted);white-space:normal;line-height:1.35;margin-top:2px;}
@media (max-width:820px){.scan-out-grid{grid-template-columns:repeat(2,1fr);}}
/* == CSS:REPORT == */
/* == CSS:MEMORY == */
/* New Full Scan scope summary / confirm, data-plane picker, run-page degradation banner */
.cfg-sum{margin-top:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card2);font-size:13.5px;line-height:1.5;color:var(--espresso);}
.cfg-sum-warn{margin-top:6px;color:#B3401F;font-size:13px;}
.cfg-baseline{margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.cfg-baseline .cfg-full{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;white-space:nowrap}
.rd-incr{margin:8px 0 0;padding:8px 11px;border:1px dashed var(--line);border-radius:9px;overflow-wrap:anywhere;font-size:13.5px;line-height:1.55;color:var(--espresso);background:var(--card2)}
.rd-incr b{font-weight:600}.rd-incr .rd-incr-sub{color:var(--muted);font-size:13px}
.cfg-confirm{margin-top:10px;padding:10px 12px;border:1px solid var(--honey);border-radius:10px;background:var(--honey-tint);font-size:13.5px;color:var(--espresso);}
.cfg-confirm-acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}
.cfg-planes{display:flex;flex-direction:column;gap:6px;}
.cfg-planes .cfg-item[aria-checked]{cursor:pointer;}
.cfg-empty-note{font-size:13px;color:var(--muted);}
[role="checkbox"]:focus-visible,[role="radio"]:focus-visible,[role="button"]:focus-visible{outline:2px solid var(--num);outline-offset:2px;}
.run-degraded{border:1px solid #E0B48A;background:#FDF1E4;color:#6B3A12;border-radius:12px;padding:10px 14px;font-size:13.5px;line-height:1.5;}
.run-degraded b{font-weight:650;}
.run-degraded ul{margin:4px 0 0 18px;}
[data-theme="dark"] .run-degraded{background:#3A2616;border-color:#7A4A22;color:#F3D6B8;}
.scan-hero-scope{margin-top:2px;font-size:14px;color:var(--muted);}
/* Shell, navigation, copy, a11y, mobile */
/* One keyboard focus ring for every native control too (the rule above covers the ARIA role controls). */
:where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:none;box-shadow:var(--focus-ring);}
.navitem:focus-visible,.side-cta:focus-visible{box-shadow:0 0 0 2px #FEC240;}
/* A [hidden] nav entry must stay hidden even though .navitem sets display:flex */
.navitem[hidden]{display:none!important;}
/* Skip link — off-screen until focused (first Tab stop on the page) */
.skip-link{position:fixed;left:12px;top:-60px;z-index:300;background:var(--honey);color:#3E261C;font-weight:600;font-size:14px;padding:9px 14px;border-radius:9px;text-decoration:none;transition:top .12s;}
.skip-link:focus,.skip-link:focus-visible{top:12px;}
#mainContent:focus{outline:none;}
/* ✎ is a real <button aria-label="Rename"> — strip the native button chrome */
button.run-title-pencil{border:none;background:none;color:inherit;font:inherit;padding:0 3px;cursor:pointer;line-height:1;border-radius:4px;}
.rfolder button.run-title-pencil:focus-visible{opacity:1;}
/* Destructive actions read as destructive */
.rf-side-act.danger{color:var(--crit);}
.rf-side-act.danger:hover{color:#8E2A1F;}
[data-theme=dark] .rf-side-act.danger{color:#E8A89B;}
.paid-tag{display:inline-block;margin-left:5px;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--high);border:1px solid currentColor;border-radius:999px;padding:0 5px;line-height:14px;vertical-align:1px;}
.paid-hint{font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.45;}
/* The Report Assistant pill sits in the topbar (Report screen only), not floating over page content */
.ctx-right .cdfab{position:static;box-shadow:none;padding:7px 13px;font-size:13px;border-radius:999px;}
/* Rendered Markdown (mdLite) */
.md .md-p{margin:3px 0;}
.md .md-h{font-weight:680;color:var(--espresso);margin:9px 0 3px;}
.md .md-h1{font-size:1.04em;}.md .md-h2{font-size:.97em;}.md .md-h3{font-size:.93em;}
.md .md-ul{margin:4px 0;padding-left:18px;}.md .md-ul li{margin:2px 0;}
.md .md-code{background:var(--card2);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-family:var(--font-mono);font-size:.86em;}
.md a{color:var(--honey-link);text-decoration:underline;}
.mem-full-body.md{white-space:normal;}
/* Report library search + kind filter */
.lib-stat{background:var(--cream-card);padding:13px 16px;min-width:0;}
.lib-stat-n{font-size:25.5px;font-weight:600;color:var(--num);line-height:1;}
/* console polish: at phone width the 3-cell stat strip keeps "$72.13" inside its ~85px cell */
@media (max-width:720px){.lib-stat{padding:12px 9px;}.lib-stat-n{font-size:18px;}}
.lib-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;}
.lib-search{flex:1;min-width:200px;height:36px;border:1px solid var(--line);border-radius:9px;background:var(--cream-card);color:var(--espresso);padding:7px 11px;font:inherit;font-size:14px;}
/* At phone width the topbar collapses to a status chip — badge + truncated title; the stage dots, stats, meta and
   the assistant label drop, and the right cluster may shrink instead of pushing the document wider than the screen. */
@media (max-width:720px){
  .ctx-topbar{padding:10px 12px;gap:8px;}
  .ctx-topbar.no-run .ctx-lead{display:none;}
  .ctx-run,.ctx-runstats,.ctx-meta{display:none!important;}
  /* The LEAD shrinks (title ellipsizes); the right cluster keeps its natural width — shrinking it let the theme
     toggle spill 10px past a 390px screen. */
  .ctx-lead{flex:1 1 0;min-width:0;gap:8px;}
  .ctx-title{font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .ctx-right{flex:0 0 auto;gap:6px;}
  .report-toggle{flex-wrap:wrap;padding:8px 12px;row-gap:4px;}
  .report-toggle .rt-title{min-width:0;overflow-wrap:anywhere;white-space:normal;}
  .report-toggle .rt-kind{display:none;}   /* the active tab right below already names it */
  .report-toggle .rt-meta{margin-left:0;flex:1 1 0;}   /* id · time on ONE ellipsized line, beside Open in new tab */
  .theme-seg{padding:2px;}
  .theme-seg button{padding:4px 7px;font-size:10.5px;letter-spacing:0;}
  .ctx-right .cdfab{padding:6px 9px;}
  .ctx-right .cdfab .cdfab-l{display:none;}
  .ctx-action{padding:7px 10px;font-size:13px;}
}
@media (max-width:420px){
  .theme-seg button:not(.on){display:none;}
}
/* Version line in the sidebar footer. */
.side-ver{padding:0 8px;font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;color:var(--nav-muted);}
/* First-run key prompt (no Claude credential yet) — a full-width card above every tab. */
.firstrun{flex:none;margin:16px 30px 0;padding:16px 18px;border:1px solid var(--honey);border-radius:14px;background:var(--honey-tint);box-shadow:var(--card-shadow);}
.firstrun[hidden]{display:none;}
.firstrun .fr-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;}
.firstrun .fr-ico{width:30px;height:30px;border-radius:9px;background:var(--honey);color:var(--espresso);display:flex;align-items:center;justify-content:center;flex:none;font-size:15px;}
.firstrun .fr-title{font-size:16px;font-weight:600;color:var(--espresso);}
.firstrun .fr-sub{font-size:13.5px;color:var(--ink2);line-height:1.5;margin-top:3px;}
.firstrun .fr-sub a,.tele-banner a,.key-gate a,.cap-line a,.nc-foot a{color:var(--honey-link);font-weight:600;}
.firstrun .set-keys{max-width:640px;}
/* Telemetry notice banner (shown once while telemetry is on). */
.tele-banner{flex:none;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:12px 30px 0;padding:10px 14px;border:1px solid var(--line);border-radius:11px;background:var(--cream-card);font-size:13.5px;color:var(--ink2);}
.tele-banner[hidden]{display:none;}
.tele-banner .tb-txt{flex:1;min-width:220px;line-height:1.5;}
.tele-banner .tb-btns{display:flex;gap:8px;}
.tele-banner .btn{padding:6px 13px;font-size:13px;}
/* Blocked-run message + the per-run cap line on the New Full Scan / Quick Ask forms. */
.key-gate{margin-top:10px;padding:9px 12px;border:1px solid #E6BCAE;border-radius:9px;background:rgba(192,57,43,.06);color:#B3401F;font-size:13.5px;}
.cap-row{margin-top:10px;font-size:13px;color:var(--muted);}
.cap-line b{color:var(--espresso);}
/* Settings page. */
.set-wrap{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}
.set-headrow{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
.set-title{font-size:24px;font-weight:600;letter-spacing:-.02em;color:var(--espresso);}
.set-ver{font-size:12.5px;color:var(--muted);margin-left:auto;}
.set-sec h2{font-size:17px;font-weight:600;color:var(--espresso);}
.set-sec-h{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.set-sec-h .sbadge{margin-left:auto;}
.set-lead{font-size:14px;color:var(--ink2);line-height:1.55;margin:0 0 10px;}
.set-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-4px 0 6px;font-size:13px;color:var(--muted);}
.set-hint{font-size:12.5px;color:var(--espresso);}
.set-src{font-size:12.5px;}
.set-clear{padding:4px 10px!important;font-size:12.5px!important;margin-left:auto;}
.set-req,.set-opt{font-family:inherit;font-size:10.5px;letter-spacing:.06em;margin-left:6px;padding:1px 6px;border-radius:999px;border:1px solid var(--line);}
.set-req{color:#B3401F;border-color:#E6BCAE;}
.set-check{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--espresso);margin-top:10px;cursor:pointer;}
.set-check.disabled{opacity:.55;cursor:not-allowed;}
.set-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;}
.set-dollar{font-family:'Geist Mono',ui-monospace,monospace;color:var(--muted);}
.set-msg{font-size:12.5px;color:var(--honey-link);}
.set-sub{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px;}
.set-fields{margin:0;padding-left:18px;font-size:13.5px;line-height:1.7;color:var(--ink2);}
.set-pre{margin:0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card2);font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;line-height:1.55;color:var(--espresso);overflow:auto;max-height:360px;white-space:pre;}
@media (max-width:760px){ .firstrun,.tele-banner{margin-left:14px;margin-right:14px;} }
`;


// ── New Full Scan / run-page helpers ────────────────────────────
// PURE client-side functions (no DOM, no `state`, ES5 like the rest of CLIENT) kept in their OWN block so the test
// suite can evaluate exactly the code the browser runs (serverUi.test.ts builds them with `new Function`). CLIENT
// interpolates this block verbatim; nothing here may reference a CLIENT-local binding. Every input is defensive about
// fields the server may not send yet (run.degraded / liveCostUsd / codeintelInReports / ruledOut are lane-S fields
// that older run records never carry).
export const SCAN_FORM_HELPERS_JS = String.raw`
  // "1 repo" / "2 repos" — the plural bug class ("1 repos", "1 folders") in one place.
  function plural(n,one,many){ n=Number(n)||0; return n+' '+(n===1?one:(many||one+'s')); }
  // The New Full Scan source chip count ('0 / 1 folder', '2 / 3 repos'). The noun agrees with the TOTAL;
  // an unknown kind falls back to 'item(s)'.
  var SRC_CHIP_NOUN={github:['repo','repos'],giturl:['repo','repos'],local:['folder','folders'],analytics:['dataset','datasets'],bi:['dashboard','dashboards']};
  function srcChipNoun(kind,n){ var w=SRC_CHIP_NOUN[kind]||['item','items']; return (Number(n)||0)===1?w[0]:w[1]; }
  function srcChipCount(kind,sel,tot){ return (Number(sel)||0)+' / '+(Number(tot)||0)+' '+srcChipNoun(kind,tot); }
  // Server-built run.targetName strings ("1 repos · 1 folders") predate plural(); repair them for display.
  function fixCountPlurals(s){ return String(s==null?'':s).replace(/(^|[^0-9.])1 (repo|folder|project|public repo|channel|dataset|dashboard)s\b/g,function(_m,pre,noun){ return pre+'1 '+noun; }); }
  // The one run-title builder (run hero, topbar, history cards, report library). A Full Scan's targetName is
  // server-built ("1 repo · 2 folders"); runs stored before the server learned singulars still say "1 repos", so the
  // Full Scan branch is repaired through fixCountPlurals. Ask targets (and LEGACY Design Doc runs from the removed tab)
  // are free text and left verbatim.
  function runTitle(r){ if(r.renamed) return r.renamed; if(r.kind==='ask') return 'Quick Ask · '+(r.targetName||'question'); if(r.kind==='audit') return 'Rec audit · '+(r.targetName||'audit'); if(r.kind==='design') return 'Design doc (legacy) · '+(r.targetName||'design'); return r.targetName ? 'Full Scan · '+fixCountPlurals(r.targetName) : 'Full Scan run'; }
  // UI-3/6 — the title WITHOUT the kind prefix, for places that already show the kind (the reading-room pill, a
  // history card inside its own kind's tab), so they don't read "QUICK ASK  Quick Ask · …".
  function runTitleBare(r){ if(r.renamed) return r.renamed; if(r.kind==='ask') return r.targetName||'question'; if(r.kind==='audit') return r.targetName||'audit'; if(r.kind==='design') return r.targetName||'design'; return r.targetName ? fixCountPlurals(r.targetName) : 'Untitled run'; }
  // Once a run is terminal its cost is the ACTUAL spend, not an estimate.
  function costWord(status){ return (status==='complete'||status==='error'||status==='stopped')?'cost':'est. cost'; }
  function usd(n){ n=Number(n); if(!isFinite(n)) return '—'; return '$'+(n<100?n.toFixed(2):String(Math.round(n))); }
  // The remembered New Full Scan selection. The snapshot holds ids only (no secrets).
  function scanSelStorageKey(orgId){ return 'theresa.scanSel.v1.'+(orgId||'_none'); }
  function snapshotScanSel(artSel,planeSel,memoryRecall){
    function on(m){ var o=[]; for(var k in (m||{})) if(Object.prototype.hasOwnProperty.call(m,k)&&m[k]===true) o.push(k); return o; }
    return { art:on(artSel), planes:on(planeSel), memoryRecall:memoryRecall===true };
  }
  // NOTHING pre-ticked: every currently-available id starts false; a saved snapshot re-ticks only ids that still exist
  // (a stale id — a disconnected repo or plane — is dropped, never resurrected).
  function restoreScanSel(saved,artKeys,planeIds){
    var out={ art:{}, planes:{}, memoryRecall:false };
    function seed(dst,ids,picked){ (ids||[]).forEach(function(k){ dst[k]=false; }); (picked||[]).forEach(function(k){ if(Object.prototype.hasOwnProperty.call(dst,k)) dst[k]=true; }); }
    var s=(saved&&typeof saved==='object')?saved:{};
    seed(out.art,artKeys,Array.isArray(s.art)?s.art:[]);
    seed(out.planes,planeIds,Array.isArray(s.planes)?s.planes:[]);
    out.memoryRecall=s.memoryRecall===true;
    return out;
  }
  // The one-line scope summary above "Run diagnosis" + whether the run needs an explicit confirm step.
  // o: {repos, publicRepos, folders, planes, bundles (null = auto), memoryRecall, siblingRecall, saveLearnings, publicOnly
  //     (the selection is public-URL repos only and every connected source is a Public GitHub URL — osvPublicOnly),
  //     cap (null = unknown, 0 = uncapped)}. A data plane asks for a confirm (it reaches a live system).
  // UI-4: 0 repos + ≥1 uploaded folder ⇒ warn that the git-derived parts (History appendix, churn) will be empty.
  function scanSummary(o){
    o=o||{}; var nRepo=(Number(o.repos)||0)+(Number(o.publicRepos)||0);
    var parts=[plural(nRepo,'repo'), plural(o.folders,'folder')];
    parts.push(plural(o.planes,'data source'));
    parts.push(o.bundles==null?'bundles: auto':plural(o.bundles,'bundle'));
    parts.push('memory recall '+(o.memoryRecall?'on':'off'));
    // The sibling-recall tick: a public-only selection (the OSV plane mounts) compares with PUBLIC projects only.
    parts.push('compare with my other projects: '+(o.siblingRecall?'on'+(o.publicOnly?' (public projects only)':''):'off'));
    parts.push('save learnings '+(o.saveLearnings?'on':'off'));   // the "Save learnings to memory" tick (one name across Full Scan + Quick Ask)
    if(o.cap===0) parts.push('no per-run cap'); else if(o.cap!=null) parts.push('per-run cap '+usd(o.cap));
    var warn=(!nRepo&&(Number(o.folders)||0)>0)?'Uploaded folders carry no git history — the History appendix and churn metrics will be empty.':'';
    return { text:parts.join(' · '), warn:warn, needsConfirm:(nRepo>5||(Number(o.planes)||0)>0) };
  }
  // Incremental re-scan — the config summary's BASELINE line, from the
  // GET /api/scan-baseline preview: "Baseline: <date> by <who> · N of M repos changed (X files) · est. $a–b instead of
  // ~$c". info: that response (or {loading:true}); fullRescan: the form's "Full rescan" tick. The tick is offered only
  // when a baseline exists (canFullRescan).
  function baselineLine(info,fullRescan){
    if(!info) return { text:'', show:false, canFullRescan:false };
    if(info.loading) return { text:'Baseline: checking for an earlier scan of this exact target set…', show:true, canFullRescan:false };
    if(info.error) return { text:'Baseline: could not be checked ('+info.error+') — the run decides after it clones.', show:true, canFullRescan:false };
    if(!info.baseline) return { text:'Baseline: none — '+String(info.reason||'first scan of this target set').replace(/^no usable baseline — /,'')+'. This run is a full scan.', show:true, canFullRescan:false };
    var b=info.baseline, r=info.repos||{}, e=info.estimate;
    var parts=['Baseline: '+b.date+(b.by?' by '+String(b.by).split('@')[0]:'')];
    if(r.changed==null) parts.push('repo changes unknown');
    else parts.push(r.changed+' of '+plural(r.total,'repo')+' changed'+(r.changed&&r.files!=null?' ('+(r.diverged?'≤ '+plural(r.files,'file')+', diverged history':plural(r.files,'file'))+')':'')+(r.unknown?' · '+r.unknown+' unknown':''));
    var fu=(e&&e.fullUsd)||b.fullUsd;
    if(fullRescan) parts.push('full rescan'+(fu?' (~'+usd(fu)+')':''));
    else if(info.full) parts.push('full scan — '+info.full+(fu?' (~'+usd(fu)+')':''));
    else if(e) parts.push('est. '+usd(e.lowUsd)+'–'+usd(e.highUsd)+(e.fullUsd?' instead of ~'+usd(e.fullUsd):''));
    else if(info.estimateNote) parts.push(info.estimateNote);
    return { text:parts.join(' · '), show:true, canFullRescan:true };
  }
  // The run page's incremental note (hero + Checkpoints card): what an incremental run reused and why the rest re-ran.
  // inc: run.incremental (server-built IncrementalSummary). Returns display lines ([] = nothing to say).
  // Lanes are named with the graph's display names (bundleDisplayName, SHELL_HELPERS_JS — "Business logic", not
  // product-logic) and a Change lane is explained in plain words ("re-checked 1 changed file of 607 it read").
  function laneName(id){
    var raw=String(id||''); if(typeof bundleDisplayName!=='function') return raw;
    var nm=bundleDisplayName(raw); if(nm!==raw||!raw) return nm;
    var w=raw.replace(/[-_]+/g,' ').replace(/\bsaas\b/i,'SaaS'); return w.charAt(0).toUpperCase()+w.slice(1);   // an unmapped (derived) bundle id still reads as words
  }
  function changeLaneLine(l){
    var m=/^(\d+) of (\d+) read file\(s\) changed(.*)$/.exec(String(l.reason||''));
    var what=m?'re-checked '+plural(Number(m[1]),'changed file')+' of '+m[2]+' it read'+m[3]:'re-checked only the changed files'+(l.reason?' — '+l.reason:'');
    return laneName(l.id)+' — '+what+(l.rechecks?' · '+plural(l.rechecks,'earlier finding')+' re-checked':'');
  }
  function incrementalNote(inc){
    if(!inc||!inc.mode) return [];
    var out=[]; var base=inc.baselineAt?'the scan of '+String(inc.baselineAt).slice(0,10):(inc.baselineRunId?'the previous scan':'');   // a date, never an internal run id
    if(inc.mode==='unchanged') out.push('No changes since '+base+' — reused its results up to the findings ($0); only the reports were re-rendered.');
    else if(inc.mode==='incremental'){
      var dl=inc.lanesDelta||[], na=inc.lanesNotActivated||[], n=(inc.lanesReused||[]).length, m=n+(inc.lanesRerun||[]).length+dl.length;
      out.push('Incremental re-scan vs '+base+' — '+n+' of '+plural(m,'lane')+' reused'+(n?' ('+inc.lanesReused.map(laneName).join(', ')+')':'')+(dl.length?' · '+dl.length+' re-checked only what changed ('+dl.map(function(l){return laneName(l.id);}).join(', ')+')':'')+(na.length?' · '+na.length+' not activated ('+na.map(function(l){return laneName(l.id);}).join(', ')+')':'')+' · Comprehend '+(inc.comprehend==='reuse'?'reused':'re-ran'+(inc.comprehendWhy?' ('+inc.comprehendWhy+')':''))+' · '+plural(inc.changedFiles||0,'changed file'));
      // A DELTA lane: revived at $0 + a delta critique over the few changed files it depends on (+ targeted re-checks).
      // Console polish: the UI calls a delta lane a "Change" lane (incrHtml bolds the leading label); the code keeps "delta".
      dl.forEach(function(l){ out.push(changeLaneLine(l)); });
      (inc.lanesRerun||[]).forEach(function(l){ out.push('re-ran '+laneName(l.id)+' — '+l.reason); });
      // A baseline lane whose bundle this run's Comprehend did not pick neither re-ran nor was reused.
      na.forEach(function(l){ out.push('not activated this time: '+laneName(l.id)+' — Comprehend did not pick it; its earlier findings read "not re-checked"'); });
    } else if(base) out.push(String(inc.reason||'Full scan').replace(/^full scan — /,'Full scan — ')+' ('+base+' was used for the comparison only)');
    if(inc.since){ var ub=uncheckedBreakdownText(inc.since.uncheckedWhy); out.push('Since last scan: '+inc.since.fixed+' fixed · '+inc.since['new']+' new · '+inc.since.persisting+' persisting'+(inc.since.changed?' · '+inc.since.changed+' changed':'')+(inc.since.unchecked?' · '+inc.since.unchecked+' not counted as fixed'+(ub?' ('+ub+')':''):'')); }
    return out;
  }
  // The per-reason counts of the "not counted as fixed" rows (sinceLastScan.uncheckedBreakdown, same words).
  function uncheckedBreakdownText(by){
    if(!by) return '';
    var order=[['recheck-budget','re-check skipped (budget)'],['recheck-unsettled','re-check unsettled'],['not-run','review not run'],['incomplete','review incomplete'],['code-unchanged','code unchanged']];
    return order.filter(function(o){ return by[o[0]]; }).map(function(o){ return by[o[0]]+' '+o[1]; }).join(' · ');
  }
  // How a bundle LANE relates to the baseline — 'reused' (replayed at $0), 'delta' (revived + a delta
  // critique), 'rerun' (re-ran whole), 'new' (not in the baseline), '' (no baseline / not known). From the run record's
  // incremental summary, or from the replay markers a lane logs (a MANUAL resume has no summary: its lanes log
  // "⟳ lane reused from <parent>"). marks: {cached, delta} for this lane.
  function laneReuseKind(inc,key,marks){
    marks=marks||{};
    if(marks.cached) return 'reused';
    if(marks.delta) return 'delta';
    if(!inc||!inc.mode) return '';
    if(inc.mode==='unchanged') return 'reused';
    if(inc.mode!=='incremental') return '';
    if((inc.lanesReused||[]).indexOf(key)>=0) return 'reused';
    if((inc.lanesDelta||[]).some(function(l){ return l.id===key; })) return 'delta';
    var r=(inc.lanesRerun||[]).filter(function(l){ return l.id===key; })[0];
    if(r) return /not in the baseline/.test(String(r.reason||''))?'new':'rerun';
    return '';
  }
  // The lane card's tag for that kind: { cls, text, title }; null = no tag.
  function laneReuseTag(kind,inc,key){
    var find=function(arr){ return (arr||[]).filter(function(l){ return l.id===key; })[0]; };
    if(kind==='reused') return { cls:'cached', text:'⟳ reused · $0', title:'reused: nothing it read changed — $0 (replayed from the baseline)' };
    // Console polish: a delta lane reads "Change · N files" (bold label, no Δ glyph); .bold = the leading label to embolden.
    if(kind==='delta'){ var d=find(inc&&inc.lanesDelta); return { cls:'delta', bold:'Change', text:'Change'+(d&&d.files?' · '+plural(d.files,'file'):''), title:'Change: only the changed files were re-checked'+(d&&d.reason?' — '+d.reason:'') }; }
    if(kind==='rerun'){ var r=find(inc&&inc.lanesRerun); return { cls:'rerun', text:'↻ re-ran', title:'re-ran whole'+(r&&r.reason?' — '+r.reason:'') }; }
    if(kind==='new') return { cls:'rerun', text:'+ new lane', title:'not in the baseline — activated by this run’s Comprehend' };
    return null;
  }
  // The run hero bound to the live spend. While a run is live the console polls GET /api/runs/:id (the
  // run record's costUsd is updated incrementally by the ledger) at most every minMs; mergeLiveSpend applies a reply.
  function liveSpendDue(lastAt,now,minMs){ return lastAt==null || (now-lastAt)>=(minMs==null?5000:minMs); }
  function mergeLiveSpend(run,d){
    if(!run||!d||d.costUsd==null) return false;
    var c=Number(d.costUsd); if(!isFinite(c)) return false;
    if(run.status==='complete'||run.status==='error'||run.status==='stopped') return false;   // the terminal total is the finish payload's
    if(run.costUsd!=null&&Number(run.costUsd)===c) return false;
    run.costUsd=c; return true;
  }
  // The same repo ticked through two sources (GitHub + public URL) would be cloned and analyzed twice.
  function repoIdentity(id){ return String(id||'').trim().toLowerCase().replace(/^https?:\/\/(www\.)?github\.com\//,'').replace(/\.git$/,'').replace(/\/+$/,''); }
  function duplicateRepoTargets(sources,artSel){
    var seen={}; var order=[];
    (sources||[]).forEach(function(s){ if(s.kind!=='github'&&s.kind!=='giturl') return;
      (s.artifacts||[]).forEach(function(a){ if(!artSel||artSel[s.id+'::'+a.id]!==true) return; var k=repoIdentity(a.id); if(!k) return;
        if(!seen[k]){ seen[k]={ repo:a.label||a.id, sources:[] }; order.push(k); }
        if(seen[k].sources.indexOf(s.name)<0) seen[k].sources.push(s.name); }); });
    return order.filter(function(k){ return seen[k].sources.length>1; }).map(function(k){ return seen[k]; });
  }
  // An uploaded folder's picker sub-line carries its upload time + file count so two uploads are distinguishable.
  function localFolderSub(a,now){
    var bits=['local folder'];
    // Seconds too — two uploads of the same folder a few seconds apart read identically at minute precision.
    if(a&&a.uploadedAt){ var d=new Date(a.uploadedAt); if(!isNaN(d.getTime())){ var opts={month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}; if(Math.abs((now==null?Date.now():now)-d.getTime())>182*86400000) opts.year='numeric'; try{ bits.push('uploaded '+d.toLocaleString('en-US',opts)); }catch(_){} } }
    if(a&&a.count!=null&&isFinite(Number(a.count))) bits.push(plural(Number(a.count),'file'));
    return bits.join(' · ');
  }
  // The + New chooser's cost hint from your RECENT ACTUALS (completed runs with a real cost), else nothing.
  function recentCostHint(runs,kind){
    var xs=[];
    for(var i=0;i<(runs||[]).length&&xs.length<10;i++){ var r=runs[i]; if(!r||r.status!=='complete') continue;
      var rk=r.kind||'org'; if(kind==='scan'?rk!=='org':rk!==kind) continue;
      var c=Number(r.costUsd); if(r.costUsd==null||!isFinite(c)||c<=0) continue; xs.push(c); }
    if(!xs.length) return '';
    if(xs.length===1) return 'last run '+usd(xs[0]);
    xs.sort(function(a,b){return a-b;});
    return usd(xs[0])+'–'+usd(xs[xs.length-1])+' over the last '+xs.length+' runs';
  }
  // The run hero's spend line: live spend while running (run.liveCostUsd when the server streams it, else the
  // incrementally-persisted run.costUsd), against the per-run cap, with an over-cap note.
  function spendInfo(run,cap){
    run=run||{}; var live=!(run.status==='complete'||run.status==='error'||run.status==='stopped');
    var spent=(live&&run.liveCostUsd!=null)?Number(run.liveCostUsd):(run.costUsd!=null?Number(run.costUsd):null);
    if(spent!=null&&!isFinite(spent)) spent=null;
    var capN=(cap!=null&&isFinite(Number(cap))&&Number(cap)>0)?Number(cap):null;
    var over=(spent!=null&&capN!=null&&spent>capN)?Math.round((spent/capN-1)*100):0;
    return { label:live?'spent so far':'cost', value:spent==null?'—':usd(spent), cap:capN==null?'':usd(capN)+' per-run cap', overPct:over };
  }
  // A DETERMINISTIC full scan has no Comprehend / bundles / Analyst⇄QC: it is one evidence scan and the internal
  // report. The 8-stage agentic graph showed "bundles activate when Comprehend finishes" on a COMPLETE deterministic run,
  // "stage 8/8 · Reports · Analyst ⇄ QC" in the topbar and every event under "Comprehend".
  function isDeterministicRun(run){ return !!run&&run.mode==='deterministic'&&run.kind!=='ask'&&run.kind!=='design'&&run.kind!=='audit'&&run.status!=='config'; }
  function detEventStage(msg){ return /^\s*(done\b|stopped by user|error:)/.test(String(msg||''))?'Report':'Scan'; }
  function detPipeline(run){
    run=run||{}; var s=run.status, n=Number(run.findings)||0;
    var scan=s==='complete'?'done':(s==='error'?'failed':(s==='stopped'?'failed':(s==='queued'?'':'running')));
    var rep=s==='complete'?'done':(s==='error'||s==='stopped'?'failed':'');
    var steps=[
      { key:'scan', title:'Evidence scan', sub:'git history · code structure · committed secrets — no agents', st:scan },
      { key:'report', title:'Internal report', sub:(s==='complete'?plural(n,'finding')+' · ':'')+'deterministic', st:rep },
    ];
    var idx=rep?1:0;
    return { steps:steps, idx:idx, total:2, label:steps[idx].title };
  }
  // The degradation banner rows: run.degraded[] ({stage,reason,at}) plus the boot-time OpenAI auth probe flag.
  // The degraded banner speaks in plain stage names and never shows an env-var name (polish): the stage id maps to a
  // label (unknown ids → words), an OpenAI key that is missing / rejected reads "the OpenAI model was unavailable, so a
  // fallback was used", and any other SHOUTY_ENV_NAME becomes "a server setting". The raw row stays in a title tooltip.
  var DEGRADED_STAGE_NAMES={ 'leadership-writer':'Leadership writing', 'report-redteam':'Report review', 'org-facts':'Fact extraction',
    'html-qc':'Report quality check', 'qc-judge':'Report quality check', 'ask-translate':'Translation', 'ask-investigate':'Investigation',
    'ask-workspace':'Code checkout', 'report-writer':'Report writing', 'area-report':'Area report', 'codex':'Drafting assistant',
    'synthesis':'Synthesis', 'design-evolution':'Design & evolution report', 'normalize':'Combined report',
    'normalize-visual-qc':'Combined report style check', 'reconcile':'Cross-report consistency check', 'budget':'Spend cap',
    'openai-auth':'OpenAI model', 'openai':'OpenAI model', 'bundle':'Expert lane', 'jobs-run':'Background job',
    'jobs-run-transport':'Background job', 'metadata-token':'Cloud credentials' };
  function degradedStageLabel(id){
    var k=String(id||'');
    if(Object.prototype.hasOwnProperty.call(DEGRADED_STAGE_NAMES,k)) return DEGRADED_STAGE_NAMES[k];
    var w=k.replace(/[-_]+/g,' ').trim(); return w?w.charAt(0).toUpperCase()+w.slice(1):'Run';
  }
  var OPENAI_FALLBACK='the OpenAI model was unavailable, so a fallback was used';
  function plainDegradedReason(reason){
    var r=String(reason||'');
    r=r.replace(/\(?OPENAI_API_KEY (?:was )?not set\)?/g,function(m){ return m.charAt(0)==='('?'('+OPENAI_FALLBACK+')':OPENAI_FALLBACK; })
       .replace(/OPENAI_API_KEY was rejected at boot \(401\)/g,OPENAI_FALLBACK)
       .replace(/OpenAI auth failed \(401\) — check OPENAI_API_KEY/g,OPENAI_FALLBACK)
       .replace(/the OpenAI key failed its boot auth check/g,OPENAI_FALLBACK);
    if(/\b401\b|unauthori[sz]ed|invalid[_ ]api[_ ]key|incorrect api key/i.test(r)&&/openai|gpt|codex/i.test(r)&&r.indexOf(OPENAI_FALLBACK)<0) r=OPENAI_FALLBACK;
    return r.replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/g,'a server setting');
  }
  function degradedRows(run,openaiAuthOk){
    var out=[];
    if(openaiAuthOk===false) out.push({ stage:'openai', reason:'the OpenAI key failed its boot auth check — GPT / codex stages (report QC, reconcile, normalizer judge) fall back or are skipped' });
    var d=(run&&Array.isArray(run.degraded))?run.degraded:[];
    d.forEach(function(x){ if(x&&(x.stage||x.reason)) out.push({ stage:String(x.stage||'run'), reason:String(x.reason||'') }); });
    return out;
  }
  // The same degradation warning banner as the Full Scan run hero, for the Quick Ask detail (degradedRows → one list).
  // '' when nothing degraded. Uses esc (SHELL_HELPERS_JS, same CLIENT scope).
  function degradedBannerHtml(rows){
    if(!rows||!rows.length) return '';
    return '<div class="run-degraded" role="status"><b>⚠ '+esc(plural(rows.length,'stage'))+' degraded in this run</b> — the run carried on (fail-open), but these steps fell back or were skipped, so read the affected output with care:<ul>'
      +rows.map(function(d){ return '<li title="'+esc(d.stage+': '+d.reason)+'"><b>'+esc(degradedStageLabel(d.stage))+'</b> — '+esc(plainDegradedReason(d.reason))+'</li>'; }).join('')+'</ul></div>';
  }
  // The Code intelligence card claims maps "inside the reports" ONLY when the run recorded that a report
  // actually carries them (run.codeintelInReports, from reportHasCodeintelViz). Unknown (legacy run / still running)
  // is worded as unknown, never as a promise.
  function codeintelCardCopy(run){
    run=run||{};
    if(run.codeintelInReports===true) return { tag:'cross-repo maps', body:'Cross-repo service map, shared-table contracts and per-repo code health — rendered inside the generated reports for this run.', link:true };
    if(run.codeintelInReports===false) return { tag:'unavailable', body:'Code intelligence was on for this run, but the code-intelligence plane was unavailable or not indexed — no report carries its maps.', link:false };
    if(run.status==='complete') return { tag:'not recorded', body:'Code intelligence was on for this run. This run did not record whether its maps made it into the reports — open a report to check.', link:true };
    return { tag:'pending', body:'Code intelligence is on. If the index builds, its cross-repo maps are rendered inside the reports.', link:false };
  }
  // Graph lanes: Comprehend's announced bundles, UNIONED with the bundle-frontier/barrier checkpoints' completed
  // set and the produced per-bundle area reports (a derived lane — e.g. saas-tenancy — never appears in the
  // Comprehend line, so the graph showed 3 lanes against a 4/4 checkpoint). Order: announced first, then extras.
  function laneBundleIds(announced,checkpoints,bundleReports){
    var out=[]; function add(id){ id=String(id||'').trim(); if(id&&out.indexOf(id)<0) out.push(id); }
    (announced||[]).forEach(add);
    (checkpoints||[]).forEach(function(c){ if(c&&(c.id==='frontier'||c.id==='barrier')&&Array.isArray(c.bundlesDone)) c.bundlesDone.forEach(add); });
    (bundleReports||[]).forEach(function(b){ if(b) add(b.id); });
    return out;
  }
  // The per-run data-plane choices the form offers. SCAN_PLANE_KINDS mirrors the server's
  // DATA_PLANE_KINDS (src/run/planeSelection.ts — a test pins the two together); the ids are what POST /api/runs
  // validates in planeFilter.
  var SCAN_PLANE_KINDS=['warehouse','analytics','bi','custom','keyvalue'];
  var SCAN_PLANE_NOUN={warehouse:'warehouse',analytics:'analytics',bi:'dashboard',custom:'data MCP',keyvalue:'key-value store'};
  // The kinds a Quick Ask can mount (mirrors planeSelection.ts ASK_PLANE_KINDS — a test pins the two together).
  var ASK_PLANE_KINDS=['warehouse','keyvalue'];
  function planeChoices(sources,kinds){
    var planes=[]; kinds=kinds||SCAN_PLANE_KINDS;
    (sources||[]).forEach(function(s){
      if(s&&kinds.indexOf(s.kind)>=0) planes.push({ id:s.id, label:s.name||s.kind, sub:SCAN_PLANE_NOUN[s.kind]||s.kind, error:s.status==='error' });
    });
    return { planes:planes };
  }
  // Plane picker rows — SHARED by the Full Scan form (ns '' → data-act plane-pick, state.planeSel) and
  // the Quick Ask compose (ns 'ask' → askplane-pick, state.askPlaneSel). Nothing is ticked
  // unless the per-form selection map says so; the ids are what the create endpoint validates (planeSelection.ts).
  // Uses esc (SHELL_HELPERS_JS, same CLIENT scope).
  // Quick Ask compose — the one line naming what the ask mounts. Run scope is explicit: no repo ticked ⇒ no code.
  // mem (optional): {recall, save} — the compose form's "Recall memory" / "Save learnings to memory" ticks.
  function askScopeSummary(nRepos,nPlanes,nFolders,mem){
    var parts=[]; if(nRepos>0) parts.push(plural(nRepos,'repo')+' cloned'); if(nFolders>0) parts.push(plural(nFolders,'folder')+' copied');
    var code=parts.length?parts.join(' · ')+' read-only':'No repos or folders selected — code not mounted (data-only ask)';
    var data=nPlanes?plural(nPlanes,'data source'):'no data sources';
    var m=mem?' · memory recall '+(mem.recall?'on':'off')+' · save learnings '+(mem.save?'on':'off'):'';
    return code+' · '+data+m+'. Read-only — nothing is written to your sources.';
  }
  // Quick Ask picker — the two extra groups GET /api/ask/repos returns: "Public GitHub URLs" (data.public, fullNames not
  // already listed among the org repos — they go into POST /api/ask repos) and "Uploaded folders" (data.local, opaque ids
  // — POST /api/ask localFolders). A folder row's selection key is ASK_LOCAL_PREFIX+id so it shares the repo-row
  // checkbox / count / search / All-None machinery without ever being sent as a repo.
  var ASK_LOCAL_PREFIX='local:';
  function askExtraGroups(data,shown){
    var seen={}; (shown||[]).forEach(function(fn){ seen[fn]=1; });
    var pub=[]; ((data&&data.public)||[]).forEach(function(fn){ fn=String(fn||''); if(fn&&!seen[fn]){ seen[fn]=1; pub.push(fn); } });
    var loc=[]; ((data&&data.local)||[]).forEach(function(f){ if(f&&f.id) loc.push({ key:ASK_LOCAL_PREFIX+f.id, label:String(f.name||f.id), sub:[f.count!=null?plural(f.count,'file'):'',f.uploadedAt?String(f.uploadedAt).slice(0,10):''].filter(Boolean).join(' · ') }); });
    return { public:pub, local:loc };
  }
  // Split the ticked selection keys into POST /api/ask's repos + localFolders (folder ids no longer listed are dropped,
  // so a stale tick never 400s the ask).
  function askSplitSelection(keys,data){
    var known={}; ((data&&data.local)||[]).forEach(function(f){ if(f&&f.id) known[f.id]=1; });
    var repos=[], folders=[];
    (keys||[]).forEach(function(k){ k=String(k); if(k.indexOf(ASK_LOCAL_PREFIX)===0){ var id=k.slice(ASK_LOCAL_PREFIX.length); if(known[id]) folders.push(id); } else repos.push(k); });
    return { repos:repos, localFolders:folders };
  }
  function planePickerHtml(pc,planeSel,ns){
    function pickRow(kind,p,on){ return '<div class="cfg-item" data-act="'+ns+kind+'-pick" data-id="'+esc(p.id)+'" role="checkbox" tabindex="0" aria-checked="'+(on?'true':'false')+'"><span class="cbx'+(on?' on':'')+'" aria-hidden="true"></span><span class="cfg-lbl"><b>'+esc(p.label)+'</b> <span style="color:var(--muted)">'+esc(p.sub)+'</span>'+(p.error?' <span style="color:#B3401F">· needs reconnect</span>':'')+'</span></div>'; }
    var rows=pc.planes.map(function(p){ return pickRow('plane',p,planeSel[p.id]===true); }).join('');
    return rows?'<div class="cfg-planes" role="group" aria-label="Data sources to mount">'+rows+'</div>':'<div class="cfg-empty-note">None connected — this run reads code only.</div>';
  }
  // UI-10 — the event stream's "Hide tool calls" filter: drop rows whose eventKind is 'tool' (reads / greps / queries)
  // so the stage markers, verdicts and errors are scannable. Returns the kept rows + how many were hidden.
  function filterEventRows(evs,hideTools){
    var kept=[], hidden=0;
    (evs||[]).forEach(function(e){ if(hideTools&&e&&e.kind==='tool') hidden++; else kept.push(e); });
    return { rows:kept, hidden:hidden };
  }
  function eventFilterChip(on,hidden){
    return '<button type="button" class="ev-filter'+(on?' on':'')+'" data-act="toggle-hide-tools" aria-pressed="'+(on?'true':'false')+'" title="'+(on?'Show the tool-call rows again':'Hide tool-call rows (reads, greps, queries)')+'">Hide tool calls'+(on&&hidden?' · '+hidden:'')+'</button>';
  }
`;

// ── Shell / navigation / copy helpers ────────────────────────────
// Same contract as SCAN_FORM_HELPERS_JS: PURE, ES5, no DOM and no `state`, interpolated verbatim into CLIENT and
// evaluated by serverUi.test.ts with `new Function`, so the tests pin the code the browser actually runs. `esc` lives
// here (not in CLIENT) because mdLite needs it and the block must be self-contained; CLIENT calls it everywhere.
export const SHELL_HELPERS_JS = String.raw`
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  // The run the topbar status strip reflects is the ROUTE's run, never "the last-touched / any live run": the
  // selected Full Scan (/run?run=), the open report (/report?run=), the open Quick Ask. Every other
  // screen (Connect, Memory, Settings, the Report LIBRARY, a New-scan compose) gets null → the strip is hidden.

  function topbarRunId(view,search,ctx){
    ctx=ctx||{}; var q=null; try{ q=new URLSearchParams(search||'').get('run'); }catch(_){ q=null; }
    if(view==='run') return ctx.configOpen?null:(ctx.activeRunId||q||null);
    if(view==='report') return ctx.reportRunId||ctx.reportFolderRun||null;
    if(view==='ask') return ctx.askComposing?null:(ctx.askDetailId||null);
    return null;
  }
  // Settings → API keys: where a key came from, in plain words (no key material — the masked hint is shown beside it).
  function keySourceText(k){
    k=k||{}; if(!k.set) return 'not set';
    var what=k.kind==='oauth'?'Claude plan token':'API key';
    if(k.source==='env') return what+' from the environment (.env) — never written to disk';
    if(k.source==='saved') return what+' saved on this machine (keys.json)';
    if(k.source==='settings') return what+' set in Settings — memory only, gone on restart';
    return what;
  }
  function providerText(p){ return ({'anthropic':'your Anthropic key for every agent','anthropic+openai':'your Anthropic key, plus your OpenAI key for report writing / QC / translation','claude-subscription':'the Claude Code login found on this machine','none':'no Claude credential yet — add your Anthropic key'})[p]||'unknown'; }
  // Typical spend per run kind — shown in the + New chooser until this install has its own recent actuals.
  var TYPICAL_COST={ask:'~$0.3–1',scan:'~$5–30'};
  // UI-16 — a memory-history row's provenance line: the run id as an in-app link (data-act mem-open-run → /run?run=,
  // the href is the no-JS / new-tab fallback) and the actor when the event carries one. '' when it has neither.
  function memEvMetaLine(e){
    e=e||{}; var parts=[];
    if(e.run_id) parts.push('run <a class="mem-ev-runlink" href="/run?run='+encodeURIComponent(e.run_id)+'" data-act="mem-open-run" data-id="'+esc(e.run_id)+'">'+esc(e.run_id)+'</a>');
    if(e.actor&&String(e.actor).trim()) parts.push('by '+esc(String(e.actor).trim()));
    return parts.length?'<div class="mem-ev-run">'+parts.join(' &middot; ')+'</div>':'';
  }
  // Server errors may arrive lowercase + unpunctuated ("parent run not found") — show them as a sentence.
  function humanError(msg,fallback){
    var s=String(msg==null?'':msg).trim(); if(!s) s=String(fallback||'Something went wrong.').trim();
    s=s.charAt(0).toUpperCase()+s.slice(1);
    if(!/[.!?…]$/.test(s)) s+='.';
    return s;
  }
  // ONE locale for every date the console prints (the UI is English; a locale-less date call rendered a
  // localized date on a non-English browser). A date more than ~6 months from now carries its year.
  var UI_LOCALE='en-US';
  function toDate(t){ var d=new Date(typeof t==='number'?t:Date.parse(String(t==null?'':t))); return isNaN(d.getTime())?null:d; }
  function fmtDate(t,now){
    var d=toDate(t); if(!d) return '';
    var o={month:'short',day:'numeric'}; if(Math.abs((now==null?Date.now():now)-d.getTime())>182*86400000) o.year='numeric';
    try{ return d.toLocaleDateString(UI_LOCALE,o); }catch(_){ return ''; }
  }
  function fmtClock(t){ var d=toDate(t); if(!d) return ''; try{ return d.toLocaleTimeString(UI_LOCALE,{hour:'numeric',minute:'2-digit'}); }catch(_){ return ''; } }
  // Event-stream time: the same 12-hour en-US clock as the rest of the console, to the second.
  function fmtEventTime(t){ if(t==null||t===''||isNaN(Number(t))) return ''; var d=toDate(Number(t)); if(!d) return ''; try{ return d.toLocaleTimeString(UI_LOCALE,{hour:'numeric',minute:'2-digit',second:'2-digit'}); }catch(_){ return ''; } }
  // The time for a SYNTHESIZED terminal event (done / stopped / error) is the last real backend line's time — not
  // Date.now(), which re-stamped a finished run's "done" every time it was opened. null (no time shown) if none.
  function lastEventTime(evs){ for(var i=(evs||[]).length-1;i>=0;i--){ var t=evs[i]&&evs[i].t; if(t!=null&&!isNaN(Number(t))) return Number(t); } return null; }
  function fmtDay(t){ var d=toDate(t); if(!d) return ''; try{ return d.toLocaleDateString(UI_LOCALE,{month:'short',day:'numeric',year:'numeric'}); }catch(_){ return ''; } }
  // History-card timestamp: relative inside a week ("2d ago"), then the SAME absolute format as everywhere else
  // ("Sep 14", "Dec 1, 2025") — never the old year-less "9/14".
  function relTime(iso,now){
    var d=toDate(iso); if(!iso||!d) return ''; var n=(now==null?Date.now():now); var s=Math.max(0,(n-d.getTime())/1000);
    if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+'m ago'; if(s<86400) return Math.floor(s/3600)+'h ago';
    if(s<604800) return Math.floor(s/86400)+'d ago';
    return fmtDate(d.getTime(),n);
  }
  // Minimal, XSS-safe Markdown → HTML (Memory card bodies). Escapes FIRST, then applies a
  // small subset on the escaped text — headings, bullet lists, **bold**, *italic* / _italic_, inline code and
  // [text](http(s) link) — so the only tags in the output are the ones inserted here. Code spans are lifted out first so
  // nothing inside them is re-formatted; _italic_ needs a non-word char on both sides so snake_case ids stay intact.
  function mdInline(s){
    var codes=[];
    s=s.replace(/\`([^\`]+)\`/g,function(_m,c){ codes.push(c); return '\u0000'+(codes.length-1)+'\u0000'; });
    function emph(t){
      t=t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
      t=t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?![*\w])/g,'$1<em>$2</em>');
      return t.replace(/(^|[^\w])_([^_\s][^_]*)_(?![\w])/g,'$1<em>$2</em>');
    }
    // Links are lifted out too: the italic rules used to run over the generated href, so
    // https://x/docs/_private_/y became href=".../&lt;em&gt;private&lt;/em&gt;/y". Only the link TEXT is formatted.
    var links=[];
    s=s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,function(_m,t,u){ links.push('<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+emph(t)+'</a>'); return '\u0001'+(links.length-1)+'\u0001'; });
    s=emph(s);
    s=s.replace(/\u0001(\d+)\u0001/g,function(_m,i){ return links[Number(i)]; });
    return s.replace(/\u0000(\d+)\u0000/g,function(_m,i){ return '<code class="md-code">'+codes[Number(i)]+'</code>'; });
  }
  function mdLite(src){
    var lines=esc(src).split(/\r?\n/), out=[], inList=false;
    for(var i=0;i<lines.length;i++){ var ln=lines[i];
      var li=ln.match(/^\s*[-*]\s+(.*)$/), h=ln.match(/^(#{1,4})\s+(.*)$/);
      if(li){ if(!inList){out.push('<ul class="md-ul">');inList=true;} out.push('<li>'+mdInline(li[1])+'</li>'); continue; }
      if(inList){ out.push('</ul>'); inList=false; }
      if(h){ out.push('<div class="md-h md-h'+Math.min(h[1].length,3)+'">'+mdInline(h[2])+'</div>'); }
      else if(ln.trim()==='') { /* blank → block spacing comes from .md-p margins */ }
      else out.push('<div class="md-p">'+mdInline(ln)+'</div>');
    }
    if(inList)out.push('</ul>');
    return out.join('');
  }
  // User-facing names for source kinds (the Disconnect button said "Disconnect giturl" / "Disconnect local").
  var SOURCE_KIND_LABELS={github:'GitHub',giturl:'public repos',local:'local folders',warehouse:'warehouse',keyvalue:'key-value store',analytics:'analytics',bi:'dashboards',custom:'data MCP',mcp:'data MCPs'};
  function sourceKindLabel(kind){ return SOURCE_KIND_LABELS[kind]||'this source'; }
  // A Connect tile's sub-line without internals: Secret Manager secret NAMES and server mount paths (/data/…) are
  // dropped (the raw detail stays in the tile's tooltip).
  function friendlySourceDetail(detail){
    var s=String(detail==null?'':detail);
    s=s.replace(/Secret Manager\s*\([^)]*\)/g,'Secret Manager').replace(/Secret Manager\s+[A-Za-z0-9_.\/-]+/g,'Secret Manager');
    s=s.replace(/(^|\s)\/data\/[^\s·]*/g,'$1');
    s=s.replace(/\b(\d+) (public )?repo\(s\)/g,function(_m,n,pub){ return n+' '+(pub||'')+(n==='1'?'repo':'repos'); });   // stored "N repo(s)" details read as a real plural
    s=s.replace(/\s*·\s*(\s*·\s*)+/g,' · ').replace(/^\s*·\s*|\s*·\s*$/g,'').replace(/\s{2,}/g,' ').trim();
    return s;
  }
  // ONE display name per expert bundle, used by the pipeline graph, the run outputs, the report library, the
  // reading room and the bundle picker (the id rides along only as a muted tooltip). Order = the picker / preview order.
  var BUNDLE_ORDER=['recsys-mle','baseline','data-eng','analytics','trust-safety','swe-arch','release-eng','api-stability','appsec','mobile-ios','mobile-android','product-logic'];
  var BUNDLE_NAMES={'recsys-mle':'MLE / Recsys',baseline:'Baseline','data-eng':'Data Eng',analytics:'Analytics','trust-safety':'Trust & Safety','swe-arch':'Architecture','release-eng':'CI / Release','api-stability':'API Stability',appsec:'Security','mobile-ios':'Mobile · iOS','mobile-android':'Mobile · Android','product-logic':'Business logic'};
  function bundleDisplayName(id,fallback){ return Object.prototype.hasOwnProperty.call(BUNDLE_NAMES,id)?BUNDLE_NAMES[id]:(fallback||id||''); }
  // Report library search + kind filter, and a labeled finding count.
  function libKindOf(r){ return (r&&r.kind==='ask')?'ask':((r&&r.kind==='audit')?'audit':((r&&r.kind==='design')?'design':'scan')); }
  function filterLibraryRuns(runs,query,kind){
    var q=String(query||'').trim().toLowerCase();
    return (runs||[]).filter(function(r){
      if(!r) return false; if(kind&&kind!=='all'&&libKindOf(r)!==kind) return false; if(!q) return true;
      var hay=[r.id,r.alias,r.renamed,r.targetName,r.scope,r.askScope,r.question,r.brief].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(q)>=0;
    });
  }
  // The library's empty-state line names WHY it is empty: a kind with no reports is not a failed search.
  function libraryEmptyText(o){
    o=o||{}; if(o.trash) return 'Trash is empty.';
    if(!o.total) return 'No finished reports yet — run a Quick Ask or a full scan.';
    var q=String(o.query||'').trim(), kinded=o.kind&&o.kind!=='all';
    if(!q&&kinded) return 'No '+(o.kindLabel||'reports of this kind')+' reports yet.';
    return 'No '+(kinded&&o.kindLabel?o.kindLabel+' ':'')+'reports match this search.';
  }
  function findingsLabel(n){ if(n==null||n==='') return ''; n=Number(n); if(!isFinite(n)) return ''; return n+' finding'+(n===1?'':'s'); }
  // The confirm copy for destructive (remove), paid (resume / regenerate) and outward (publish) actions. The cost
  // hint is what you already paid for the run being re-run — a real number, never a guess.
  function costHintText(c){ c=Number(c); return (c>0&&isFinite(c))?('$'+(c<100?c.toFixed(2):String(Math.round(c)))):''; }
  function actionConfirmText(action,o){
    o=o||{}; var c=costHintText(o.costUsd); var t=o.title?('"'+String(o.title)+'"'):'this report';
    if(action==='publish') return 'Publish '+t+'?\n\nThis makes the report PUBLIC: anyone with the link can read it until you unpublish it.';
    if(action==='remove-folder') return 'Remove the folder '+(o.title?('"'+String(o.title)+'" '):'')+'from this workspace?\n\nAn uploaded copy is deleted from this machine (runs that already used it keep their reports). This cannot be undone.';
    if(action==='remove') return 'Remove '+t+' from the library?\n\nIt moves to Trash — you can restore it from there until the trash is emptied.';
    if(action==='resume') return 'Start a new run from this checkpoint?\n\nThis is a PAID run: every stage after the checkpoint re-runs live and is billed again'+(c?(' (the original run cost '+c+' in total).'):'.');
    return 'Are you sure?';
  }
`;

// ── Memory tab · Compare (cross-project org memory) ──────────────────
// Same contract as SHELL_HELPERS_JS: PURE, ES5, no DOM, no `state` — evaluated by serverUi.test.ts with `new Function`.
// compareMatrixHtml(d) renders the GET /api/org/facts/compare body DETERMINISTICALLY (no LLM): rows = entity keys, columns
// = projects, cells = fact summaries; a divergent cell (a contradiction edge) is highlighted; evidence links are the
// server-built GitHub permalinks at the fact's SHA; a restricted cell (the viewer's credential cannot reach that
// project's repos) shows no values. Self-contained escaping (cmpEsc) so the block evaluates on its own.
// Console polish: a live search box (top-right, beside the kind chips) filters the rows client-side — cmpRowText is a
// row's VISIBLE text (key + aliases + kind + differs fields + each reachable cell's summary / evidence labels / key, and
// the project name of every column the row has a cell in); cmpFilterRows matches every whitespace-separated term,
// case-insensitive. compareResultsHtml(d,q) is the part the input re-renders (so the box keeps focus while typing).
export const COMPARE_HELPERS_JS = String.raw`
  function cmpEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var CMP_KIND_LABEL={'metric-def':'Metric definitions','event-schema':'Events','table-contract':'Tables','practice':'Practices','dependency':'Dependencies'};
  function cmpSafeHref(h){ h=String(h||''); return /^https:\/\/github\.com\//.test(h)?h:''; }
  function cmpRowText(row,cols){
    var t=[row.key,(row.keys||[]).join(' '),row.kind,CMP_KIND_LABEL[row.kind]||'',(row.fields||[]).join(' '),(row.diffFields||[]).join(' ')];
    for(var j=0;j<(cols||[]).length;j++){
      var cell=(row.cells||{})[cols[j].projectId]; if(!cell) continue;
      t.push(cols[j].name);
      if(cell.restricted) continue;   // a cell the viewer cannot reach shows no values, so its values are not searchable
      t.push(cell.summary||'',cell.key||'');
      var evs=cell.evidence||[]; for(var e=0;e<evs.length&&e<3;e++) t.push(evs[e].label||'');
    }
    return t.join(' ').toLowerCase();
  }
  function cmpFilterRows(rows,cols,q){
    var terms=String(q||'').toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length) return (rows||[]).slice();
    return (rows||[]).filter(function(r){ var h=cmpRowText(r,cols); for(var i=0;i<terms.length;i++){ if(h.indexOf(terms[i])<0) return false; } return true; });
  }
  function compareMatrixHtml(d,q){
    d=d||{}; var rows=d.rows||[], cols=d.projects||[], kinds=d.kinds||[], cur=d.kind||'';
    var chips='<div class="mem-chips cmp-kinds"><button class="mem-chip'+(!cur?' on':'')+'" data-act="mem-cmp-kind" data-view="">All</button>';
    for(var i=0;i<kinds.length;i++){ chips+='<button class="mem-chip'+(cur===kinds[i]?' on':'')+'" data-act="mem-cmp-kind" data-view="'+cmpEsc(kinds[i])+'">'+cmpEsc(CMP_KIND_LABEL[kinds[i]]||kinds[i])+'</button>'; }
    chips+='</div>';
    var search=rows.length?'<div class="cmp-search-box"><input type="search" id="cmpSearch" class="cmp-search" placeholder="Filter keys, values, projects" aria-label="Filter the comparison by key, kind, value or project" autocomplete="off" spellcheck="false" value="'+cmpEsc(q||'')+'"></div>':'';
    chips='<div class="cmp-top">'+chips+search+'</div>';
    var intro='<p class="cmp-intro">Each row is one metric, table, event, practice or dependency; each column is one of your projects. A <span class="cmp-legend">highlighted</span> cell disagrees with another project on the same key. Every value is a claim from the scan named in the cell, to re-check, not ground truth.</p>';
    if(!rows.length){
      var nr0=Number(d.restrictedEntries)||0;
      return chips+intro+(nr0?'<div class="cmp-meta cmp-hidden">'+nr0+' entr'+(nr0===1?'y is':'ies are')+' recorded only in other projects whose repos you cannot open with your connected credential.</div>':'')+'<div class="rd-card cmp-empty"><b>Nothing to compare yet'+(cur?' for '+cmpEsc(CMP_KIND_LABEL[cur]||cur):'')+'.</b><br>Facts are recorded at the end of every completed Full Scan: dependency manifests, shared tables from code intelligence, and the metric, table and practice definitions the verdicts checked. Scan two or more of your projects to see them side by side.</div>';
    }
    var prop=(d.aliases&&d.aliases.proposed)||[];
    var aliasNote=prop.length?'<details class="cmp-aliases"><summary>'+prop.length+' proposed alias'+(prop.length===1?'':'es')+' (unconfirmed &mdash; used to find related facts, never to call two projects inconsistent)</summary><ul>'+prop.slice(0,30).map(function(a){ return '<li class="mono">'+cmpEsc(a.a)+' &asymp; '+cmpEsc(a.b)+'</li>'; }).join('')+'</ul></details>':'';
    // Fewer than two projects: nothing can differ yet — say so above the (still shown, for inspection) single column.
    var single=cols.length<2?'<p class="cmp-single" role="note">Compare needs at least two projects; scan another repo to see differences.</p>':'';
    return chips+single+intro+'<div id="cmpResults">'+compareResultsHtml(d,q)+'</div>'+aliasNote;
  }
  // The filtered part of the Compare view: stats line ("N of M keys" while a filter is on) + the matrix, or the
  // no-match empty state. d = the compare body, q = the search text.
  function compareResultsHtml(d,q){
    d=d||{}; var all=d.rows||[], cols=d.projects||[];
    var rows=cmpFilterRows(all,cols,q), filtering=!!String(q||'').trim();
    var nDiv=0; for(var r0=0;r0<rows.length;r0++){ if(rows[r0].divergent) nDiv++; }
    var head='<tr><th class="cmp-key">Entity</th>';
    for(var c=0;c<cols.length;c++){ head+='<th'+(cols[c].restricted?' class="cmp-restricted-h" title="You cannot open this project&#39;s repos with your connected credential, so its values are hidden."':'')+'>'+cmpEsc(cols[c].name)+'</th>'; }
    head+='</tr>';
    var body='';
    for(var r=0;r<rows.length;r++){
      var row=rows[r];
      var others=(row.keys||[]).filter(function(k){ return k!==row.key; });
      var keyCell='<td class="cmp-key"><div class="mono cmp-k">'+cmpEsc(row.key)+'</div>'
        +'<div class="cmp-kind">'+cmpEsc(CMP_KIND_LABEL[row.kind]||row.kind)+'</div>'
        +(others.length?'<div class="cmp-alias">&asymp; '+cmpEsc(others.join(', '))+'</div>':'')
        +(row.divergent?'<div class="cmp-differs">differs'+(row.fields&&row.fields.length?' on '+cmpEsc(row.fields.join(', ')):'')+'</div>':'')
        +(!row.divergent&&row.differs?'<div class="cmp-neutral">varies across projects'+(row.diffFields&&row.diffFields.length?' ('+cmpEsc(row.diffFields.join(', '))+')':'')+' &mdash; a difference, not a conflicting definition</div>':'')
        +'</td>';
      var cells='';
      for(var j=0;j<cols.length;j++){
        var cell=(row.cells||{})[cols[j].projectId];
        if(!cell){ cells+='<td class="cmp-none">&mdash;</td>'; continue; }
        var cls='cmp-cell'+(cell.divergent?' cmp-div':'')+(cell.state!=='active'?' cmp-stale':'');
        if(cell.restricted){ cells+='<td class="'+cls+' cmp-restricted">'+(cell.divergent?'Records a different value.':cell.differs?'Differs.':'Recorded.')+'<div class="cmp-meta">no access to this project&#39;s repos</div></td>'; continue; }
        var st=cell.state==='disputed'?'<div class="cmp-state">&#9888; disputed &mdash; not re-observed by the last scan</div>':'';
        var date='<div class="cmp-meta">'+cmpEsc(String(cell.measuredAt||'').slice(0,10))+(cell.key!==row.key?' &middot; '+cmpEsc(cell.key):'')+'</div>';
        var ev='';
        var evs=cell.evidence||[];
        for(var e=0;e<evs.length&&e<3;e++){ var h=cmpSafeHref(evs[e].href); ev+=h?'<a class="mono cmp-ev" href="'+cmpEsc(h)+'" target="_blank" rel="noopener noreferrer">'+cmpEsc(evs[e].label)+'</a>':'<span class="mono cmp-ev">'+cmpEsc(evs[e].label)+'</span>'; }
        cells+='<td class="'+cls+'"><div class="cmp-sum">'+cmpEsc(cell.summary||'')+'</div>'+st+(ev?'<div class="cmp-evs">'+ev+'</div>':'')+date+'</td>';
      }
      body+='<tr'+(row.divergent?' class="cmp-row-div"':'')+'>'+keyCell+cells+'</tr>';
    }
    var stats='<div class="cmp-stats mono">'+(filtering?'<b>'+rows.length+'</b> of '+all.length+' key'+(all.length===1?'':'s'):rows.length+(d.truncated?' of '+cmpEsc(d.totalRows):'')+' key'+(rows.length===1?'':'s'))+' &middot; '+cols.length+' project'+(cols.length===1?'':'s')+' &middot; <b>'+nDiv+'</b> divergent</div>';
    var nr=Number(d.restrictedEntries)||0;
    var hidden=nr?'<div class="cmp-meta cmp-hidden">'+nr+' more entr'+(nr===1?'y is':'ies are')+' recorded only in other projects whose repos you cannot open with your connected credential (not shown).</div>':'';
    if(!rows.length) return stats+hidden+'<div class="rd-card cmp-empty cmp-nomatch"><b>No keys match &ldquo;'+cmpEsc(String(q).trim())+'&rdquo;.</b><br>The filter looks at entity keys, kinds, the values you can see and project names'+(d.kind?' within '+cmpEsc(CMP_KIND_LABEL[d.kind]||d.kind):'')+'. Press Esc to clear it.</div>';
    return stats+hidden+'<div class="cmp-wrap"><table class="cmp-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>'+(d.truncated?'<div class="cmp-meta">Showing the first '+all.length+' keys &mdash; filter by kind to see the rest.</div>':'');
  }
`;

// ── Report reading guide ─────────────────────────────────────────────────────────────────────
// Same contract as SHELL_HELPERS_JS (PURE, ES5, no DOM, no `state`; interpolated verbatim into CLIENT after it, and
// evaluated by serverUi.test.ts together with SHELL_HELPERS_JS, whose bundleDisplayName it uses when present).
//   readMinutes(words)  — words / 220 wpm, rounded, min 1; null when the size is unknown (the line then omits it).
//   reportGuide(run)    — the "Start here" list: ONE recommended entry (Leadership if present, else Combined, else
//                         Detailed) first, then every other artifact in the library order, each with an audience line.
//                         `frame: true` = opens in the reading room; otherwise it is a download / new-tab link.
//                         Read time uses run.reportWords[key] when the server supplies it (keys = the export keys:
//                         internal / leadership / combined / workitems / provenance / bundle:<id>); else omitted.
//   reportFrameSrc(...) — the report route URL a reading-room kind loads (also the "Open in new tab" target).
//   reportHistoryOp(cur, next, push) — how syncReportUrl writes the /report URL: null when unchanged (re-clicking the
//                         active tab adds no entry), 'push' for a reading-room TAB switch (so Back returns to the
//                         previous tab), else 'replace' (initial load, library / folder transitions — no history spam).
export const READING_HELPERS_JS = String.raw`
  function reportHistoryOp(cur,next,push){ if(String(cur)===String(next)) return null; return push?'push':'replace'; }
  function readMinutes(words){ var n=Number(words); if(!(n>0)||!isFinite(n)) return null; return Math.max(1,Math.round(n/220)); }
  function reportFrameSrc(id,kind,bundleId){
    var base='/api/runs/'+encodeURIComponent(String(id||''));
    if(kind==='leadership') return base+'/leadership';
    if(kind==='workitems') return base+'/workitems';
    if(kind==='combined') return base+'/combined';
    if(kind==='provenance') return base+'/provenance';
    if(kind==='bundle') return base+'/bundle/'+encodeURIComponent(String(bundleId||''));
    return base+'/report';
  }
  // Two-report model: a FULL SCAN (not Quick Ask / Rec audit / legacy Design Doc) offers
  // exactly two reports — Leadership (decide) and Execution (fix + verify; REMEDIATION.md is its export button). Older
  // runs' area / combined / provenance files stay servable by URL, but are no longer offered anywhere in the console.
  function isFullScanRun(r){ return !!r&&r.kind!=='ask'&&r.kind!=='design'&&r.kind!=='audit'; }
  function internalReportLabel(r){ return (r&&r.kind==='ask')?'Answer':((r&&r.kind==='design')?'Design doc (legacy)':((isFullScanRun(r)&&r.mode==='agentic')?'Execution report':'Detailed report')); }
  function reportGuide(run){
    var r=run||{}; var out=[];
    var words=(r.reportWords&&typeof r.reportWords==='object')?r.reportWords:{};
    var mins=function(key){ return readMinutes(words[key]); };
    var withMin=function(line,key){ var m=mins(key); return line+(m?' · ~'+m+' min':''); };
    var nameOf=function(id,t){ return (typeof bundleDisplayName==='function')?bundleDisplayName(id,t):(t||id||''); };
    if(isFullScanRun(r)){
      if(r.leadership) out.push({ kind:'leadership', key:'leadership', frame:true, label:'Leadership report', recommended:true, line:'Decision makers · what to act on first · ~'+(mins('leadership')||5)+' min' });
      out.push({ kind:'internal', key:'internal', frame:true, recommended:!r.leadership, label:internalReportLabel(r),
        line:withMin(r.mode==='agentic'?'Engineers & coding agents · fix · done when · how to verify':'Engineers · every finding with evidence','internal') });
      return out;
    }
    if(r.leadership) out.push({ kind:'leadership', key:'leadership', frame:true, label:'Leadership report', line:'For decision makers · ~'+(mins('leadership')||5)+' min' });
    if(r.combined) out.push({ kind:'combined', key:'combined', frame:true, label:'Combined report', line:withMin('Everything in one place · tabs per area','combined') });
    out.push({ kind:'internal', key:'internal', frame:true,
      label:internalReportLabel(r),   // UI-21: ONE label source (Start here + library agree)
      line:withMin(r.kind==='ask'?'The answer to your question':(r.kind==='design'?'Saved design doc from the removed Design Doc tab':'Engineers · every finding with evidence'),'internal') });
    if(r.workItems) out.push({ kind:'workitems', key:'workitems', frame:true, label:'Work items', line:withMin('Engineers · item → location → context','workitems') });
    (r.bundleReports||[]).forEach(function(b){ if(!b||!b.id) return; var nm=nameOf(b.id,b.title);
      out.push({ kind:'bundle', key:'bundle:'+b.id, bundleId:b.id, frame:true, label:'Area · '+nm, line:withMin('Specialists for '+nm,'bundle:'+b.id) }); });
    if(r.provenance) out.push({ kind:'provenance', key:'provenance', frame:true, label:'Design & Evolution', line:withMin('Architects · how the design evolved','provenance') });
    if(r.kind!=='ask'&&r.kind!=='design') out.push({ kind:'remediation', key:'remediation', frame:false, label:'REMEDIATION.md', line:'Hand to a coding agent'+(r.findings!=null?' · '+r.findings+' finding'+(Number(r.findings)===1?'':'s'):'') });
    if(r.hasTrace) out.push({ kind:'trace', key:'trace', frame:false, label:'Run trace', line:'Debugging · agent trajectory' });
    if(r.hasAudit) out.push({ kind:'audit', key:'audit', frame:false, label:'Run audit', line:'Debugging · per-node log' });
    var pick=null; ['leadership','combined','internal'].some(function(k){ for(var i=0;i<out.length;i++){ if(out[i].kind===k){ pick=i; return true; } } return false; });
    if(pick!=null){ var rec=out.splice(pick,1)[0]; rec.recommended=true; out.unshift(rec); }
    return out;
  }
  // "Open report" (run hero / library / Quick Ask / anywhere without a named report) opens the entry the guide marks
  // "Start here" — Leadership for a Full Scan that has one — not Execution. A named button ("Open execution report")
  // keeps its own kind. Returns 'leadership' | 'combined' | 'internal'.
  function startHereKind(run){
    var g=reportGuide(run||{});
    for(var i=0;i<g.length;i++){ if(g[i].recommended&&g[i].frame&&(g[i].kind==='leadership'||g[i].kind==='combined'||g[i].kind==='internal')) return g[i].kind; }
    return 'internal';
  }
  // Click path: a report is sandboxed without allow-popups, so its evidence permalinks ask the console to open them
  // ({type:'accel-open-link', href}). Open ONLY a commit-pinned GitHub blob permalink into one of THIS run's own scanned
  // repos (repoFilter + giturlFilter) — a prompt-injected report script must not be able to make the console open an
  // arbitrary URL (an exfiltration channel). Pure; the caller also checks the message came from the report iframe.
  // Report scope (reportScope.ts) adds two more shapes into the SAME repos: the repo root and its commit-pinned tree
  // (…/tree/<40-hex sha>); scopeRepos covers a Quick Ask's / Rec audit's repos (askRepos / auditRepos).
  function accelOpenLinkAllowed(href,run){
    // The URL must already be in normal form: ".." / "." segments (raw or %2e-encoded) collapse in the browser and
    // could walk out of the allowed owner/repo prefix, so a href that normalization would
    // change is refused outright, and dot segments are refused even if a URL parser is unavailable.
    var h=String(href||'');
    if(/(^|\/)\.{1,2}(\/|$|#)/.test(h)||/%2e/i.test(h)||h.indexOf('\\')>=0) return false;
    try{ if(typeof URL==='function' && new URL(h).href!==h) return false; }catch(_){ return false; }
    var m=/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/blob\/[0-9a-f]{40}\/[^\s"'<>?]+(#L\d+(-L\d+)?)?$/.exec(h)
      ||/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(\/tree\/[0-9a-f]{40})?$/.exec(h);
    if(!m) return false;
    var want=(m[1]+'/'+m[2]).toLowerCase();
    var repos=[].concat((run&&run.repoFilter)||[],(run&&run.giturlFilter)||[],(run&&run.scopeRepos)||[]);
    for(var i=0;i<repos.length;i++){ if(String(repos[i]||'').toLowerCase()===want) return true; }
    return false;
  }
  // Event-stream display: drop the run's ephemeral workspace prefix (…/theresa-org-XXXX/ or C:\…\theresa-org-XXXX\) so
  // a log line reads "ky: …", not this machine's temp path. Display-only — the stored log is unchanged.
  function stripWorkspacePath(msg){
    return String(msg==null?'':msg).replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\s"'<>]+)*?[\\/]theresa-org-[A-Za-z0-9]+(?:[\\/]|(?=[\s"'<>:]|$))/g,'');
  }
`;

const CLIENT = String.raw`
(function(){
  var RUNMODE = document.body.getAttribute('data-runmode')||'deterministic';
  var LOCALAUDIT = document.body.getAttribute('data-localaudit')==='1';
  var CODEINTEL_AVAIL = document.body.getAttribute('data-codeintel')==='1';
  var DOCRECOVERY_AVAIL = document.body.getAttribute('data-docrecovery')==='1';
  var APP_VERSION = document.body.getAttribute('data-version')||'';
  var CONNECT_CLEAR_FIELDS = ${CONNECT_SUCCESS_CLEAR_FIELDS_JSON};
  // Pure New-Full-Scan / run-page helpers (SCAN_FORM_HELPERS_JS — shared verbatim with the unit tests).
${SCAN_FORM_HELPERS_JS}
  // Pure shell / navigation / copy helpers (SHELL_HELPERS_JS — shared verbatim with the unit tests; defines esc()).
${SHELL_HELPERS_JS}
  // Pure report reading-guide helpers (READING_HELPERS_JS, shared verbatim with the unit tests).
${READING_HELPERS_JS}
  // Pure Memory → Compare renderer (COMPARE_HELPERS_JS — cross-project org memory, shared verbatim with the unit tests).
${COMPARE_HELPERS_JS}
  // Shared REMEDIATION.md builder (remediationMd.ts) — the same one the report's own Export + /share retrofit run.
${REMEDIATION_MD_JS}
  // A Quick Ask / Full Scan that invokes Claude needs an Anthropic key (Settings). Until GET /api/settings has answered,
  // the key state is unknown and nothing is blocked (the server still refuses with a clear error).
  function keysMissing(){ return !!(state.settings&&state.settings.keys&&state.settings.keys.ready===false); }
  function needsClaudeToken(){ return keysMissing(); }
  var state={
    sources:[], pick:'github', artSel:{}, _selKey:'', openSrc:null, srcQuery:'', localUploadPick:null, localUploading:false, configOpen:false, briefText:'', runError:'', briefOpen:false, invSel:{}, bundleSel:{}, overrideBundles:false, targetFilter:'',
    planeSel:{}, askPlaneSel:{}, hideToolEvents:(function(){ try{ return window.localStorage.getItem('theresa.hideToolEvents')==='1'; }catch(_){ return false; } })(), memRecall:false, siblingRecall:false, scanConfirm:false, fullRescan:false, baselineSig:'', baselineInfo:null, runBudget:null, effectiveRunBudget:null, openaiAuthOk:null,   // Per-run plane/memory picks, the confirm step, and the degradation / spend flags from /api/state
    settings:null, settingsErr:'', keyMsg:'', budgetMsg:'', telemetryMsg:'', connMsg:'', saveKeys:null,   // GET /api/settings (keys · per-run cap · telemetry) + the Settings form's transient messages
    actingOrgId:null,
    runs:[], activeRunId:null, runFilter:'all', runQuery:'',
    askRunFilter:'all',
 askRunQuery:'', askDetailId:null, askComposing:false,
    detailStage:'comprehend', stagePinned:false, artifactKind:'all', artifactIndex:0,
    detailEvents:[], detailStream:null, detailStreamId:null, detailLoadedId:null, followDetail:true, detailStageNow:null, detailStageByBundle:null, detailBundles:null,
    selNode:null, selBundle:null, modalOpen:false, reportFolderRun:null, editingTitleRunId:null, reportUrlApplied:false,
    mem:null, memLoading:false, memFilter:'all', memQuery:'', memExpanded:{},
    memFull:{}, memFullLoading:{}, memEdit:{}, memDialog:null,
    memView:'cards', memHistory:null, memHistoryLoading:false,
    memDraftBusy:false, memDraftResult:null,
    memExtractBusy:{}, memExtractResult:{},
    runMemAddsOpen:{}, graphLanesOpen:false
  };
  // The 6 card types the local memory store carries — drives the filter chips + type labels on the Memory tab.
  var MEM_TYPES=['invariant','router','metric-def','mistake','playbook','release-log'];
  // Whether the server allows org-memory writes (from GET /api/memory canWrite). renderMemory() sets this; the
  // full-card edit/delete actions + click handlers read it. Server 403 is the real gate — this hides dead UI.
  var memCanWrite=false;
  // Last-rendered filter+query on the Memory tab — a change means a new result set, so the list scroll resets
  // to the top instead of being restored (only same-set repaints keep their position).
  var memListKey=null;
  var RUN_STAGES=[
    {key:'comprehend',label:'Comprehend',kind:'map · classify',sub:['systems','value chains','KPIs','company type']},
    {key:'critique',label:'Critique',kind:'read-only · broad',sub:['code','git history','warehouse']},
    {key:'preflight',label:'Preflight',kind:'plan · lint',sub:['decisive query','pre-budget lint']},
    {key:'expert',label:'Expert',kind:'measure · resolve',sub:['triage','measure live','resolve']},
    {key:'mitigate',label:'Mitigation',kind:'agent-executable',sub:['grounded fixes','tied to numbers']},
    {key:'synthesize',label:'Synthesis',kind:'by elimination',sub:['bottom line','grouped by area']},
    {key:'findings',label:'Findings',kind:'evidence-backed',sub:['confirmed','refuted','deferred']},
    {key:'report',label:'Reports',kind:'leadership + execution',sub:['leadership','execution']}
  ];
  // Expert bundles Comprehend can activate. The branching graph generates exactly one
  // lane per bundle by mapping over this array — add/remove a bundle to add/remove a lane,
  // no other code change. A real run will later pass the ACTIVE subset Comprehend chose;
  // for now all candidates render as lanes (Comprehend selects the active subset at run time).
  // Labels come from the ONE bundle display-name map (BUNDLE_NAMES in SHELL_HELPERS_JS) — graph, outputs and picker
  // all read it, so a bundle never shows under two names on one page.
  var BUNDLES=BUNDLE_ORDER.map(function(k){ return {key:k,label:bundleDisplayName(k)}; });
  var STAGE_DESC={
    comprehend:'Map the code + data: reconstruct systems, value chains, and KPIs; classify the company type and activate the right expert bundles.',
    critique:'Read-only broad scan of code + git history + warehouse → sharp, falsifiable, evidence-seeded problems (the auto-generated intake).',
    preflight:'When a data plane is mounted: plan each posed problem into a decisive, re-runnable measurement and lint it against the budget BEFORE measuring; a rejected plan becomes a coverage gap, never a silent re-measure.',
    expert:'Judge whether each planned problem is worth a deep dive; for the worthwhile ones, measure it LIVE against the warehouse / key-value plane to a verdict and work out the resolution.',
    mitigate:'Grounded, agent-executable fixes for each confirmed defect, each tied to the measured numbers that justify it.',
    synthesize:'Cross-hypothesis bottom line by elimination; group the hypotheses into business/product areas with a health verdict.',
    findings:'Evidence-backed findings — confirmed / refuted / deferred — each with resolvable evidence pointers.',
    report:'Two reports from one set of findings: the Leadership brief (what to act on first) and the deterministic Execution report (per finding: fix · done when · how to verify, grouped by theme; REMEDIATION.md is its export).'
  };

  function api(p,o){ o=o||{}; o.credentials='same-origin'; o.headers=o.headers||{}; if(o.body&&typeof o.body!=='string'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);} return fetch(p,o); }
  function copyText(text){
    function fallback(){ var ta=document.createElement('textarea'); ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(_){} document.body.removeChild(ta); }
    if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function(){fallback();});
    fallback(); return Promise.resolve();
  }
  // esc / mdInline / mdLite now live in SHELL_HELPERS_JS (tested by evaluating that block).
  function srcByKind(k){ for(var i=0;i<state.sources.length;i++) if(state.sources[i].kind===k) return state.sources[i]; return null; }

  // ---------- "Report Assistant" chat drawer (pins to the open report; grounded in that report only) ----------
  var CDMODELS=[{id:'claude-opus-4-8',s:'Opus'},{id:'claude-sonnet-4-6',s:'Sonnet'},{id:'claude-haiku-4-5-20251001',s:'Haiku'}];
  function cdInit(){
    if(state.cdInited){ cdSyncFab(); return; } state.cdInited=true;
    state.cdMsgs=state.cdMsgs||[]; state.cdConv=state.cdConv||null; state.cdConvs=state.cdConvs||[];
    state.cdModel=state.cdModel||localStorage.getItem('cd-model')||'claude-opus-4-8';
    // The pill lives IN the topbar (never floating over page content) and only on the Report screen.
    var fab=document.createElement('button'); fab.className='cdfab'; fab.id='cdFab'; fab.type='button'; fab.setAttribute('aria-label','Report Assistant'); fab.innerHTML='<span class="dot" aria-hidden="true"></span><span class="cdfab-l">Report Assistant</span>';
    fab.addEventListener('click',function(){ cdToggle(); });
    var ctxR=document.querySelector('.ctx-right'), tgl=document.getElementById('themeToggle');
    if(ctxR&&tgl) ctxR.insertBefore(fab,tgl); else document.body.appendChild(fab);
    var root=document.createElement('aside'); root.className='cd'; root.id='cdRoot'; root.setAttribute('role','dialog'); document.body.appendChild(root);
    root.addEventListener('click',function(e){ var t=e.target; var a=t&&t.getAttribute?t.getAttribute('data-cd'):null; if(!a&&t&&t.parentNode&&t.parentNode.getAttribute)a=t.parentNode.getAttribute('data-cd'); if(!a)return;
      if(a==='close')cdClose(); else if(a==='send')cdSend(); else if(a==='stop'){ if(state.cdAbort)state.cdAbort.abort(); }
      else if(a==='new')cdNew(); else if(a==='hist'){ state.cdListOpen=!state.cdListOpen; if(state.cdListOpen)cdLoadConvs(); else cdRender(); }
      else if(a==='unpin'){ state.cdUnpinned=true; cdRender(); } else if(a==='conv'){ cdLoadConv(t.getAttribute('data-id')); }
      else if(a==='del'){ var did=t.getAttribute('data-id'); api('/api/chat/conversations/'+encodeURIComponent(did),{method:'DELETE'}).then(function(){ if(state.cdConv===did)cdNew(); cdLoadConvs(); }); }
      else if(a==='sugg'){ cdSend(t.getAttribute('data-q')); }
      else if(a==='model'){ state.cdModel=t.getAttribute('data-id'); localStorage.setItem('cd-model',state.cdModel); cdRender(); } });
    // drag-resize: a grab strip on the drawer's LEFT edge resizes the split (the report area shrinks/grows with it).
    state.cdWidth=Number(localStorage.getItem('cd-width'))||440; if(!(state.cdWidth>=320))state.cdWidth=440;
    document.documentElement.style.setProperty('--cd-width',state.cdWidth+'px');
    root.addEventListener('pointerdown',function(e){ var t=e.target; if(t&&t.getAttribute&&t.getAttribute('data-cd')==='resize')cdStartResize(e); });
    cdSyncFab();
  }
  function cdStartResize(e){ e.preventDefault();
    function mv(ev){ var w=Math.min(Math.max(window.innerWidth-ev.clientX,320),Math.min(window.innerWidth*0.72,920)); state.cdWidth=w; document.documentElement.style.setProperty('--cd-width',w+'px'); try{localStorage.setItem('cd-width',String(Math.round(w)));}catch(_){} }
    function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); document.body.classList.remove('cd-dragging'); document.body.style.cursor=''; }
    document.body.classList.add('cd-dragging'); document.body.style.cursor='col-resize';
    window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up); }
  function cdSyncFab(){ var f=document.getElementById('cdFab'); if(f)f.style.display=(currentView()==='report')?'flex':'none'; }
  // Pin to the report you are focused on: an OPEN report (reportRunId) or a run whose
  // report FOLDER is drilled into (reportFolderRun) — the report-context loader keys off the runId either way.
  function cdPinned(){ if(state.cdUnpinned)return null; var id=state.reportRunId||state.reportFolderRun; if(!id)return null; var r=runById(id); var label=r?((typeof runTitle==='function'?runTitle(r):null)||r.askScope||r.targetName||id):id; return {runId:id,label:label}; }
  function cdToggle(){ if(state.cdShow)cdClose(); else cdOpen(); }
  function cdOpen(){ state.cdShow=true; state.cdUnpinned=false; document.documentElement.style.setProperty('--cd-width',(state.cdWidth||440)+'px'); document.body.classList.add('cd-open'); cdRender(); var r=document.getElementById('cdRoot'); if(r){ void r.offsetWidth; r.classList.add('open'); } }
  function cdClose(){ state.cdShow=false; document.body.classList.remove('cd-open'); var r=document.getElementById('cdRoot'); if(r)r.classList.remove('open'); }
  function cdMd(s){ var BT=String.fromCharCode(96); s=esc(s); var code=new RegExp(BT+'([^'+BT+']+)'+BT,'g'); s=s.replace(code,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    function isRow(l){ return /^\s*\|.*\|\s*$/.test(l); }
    function isSep(l){ return /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.indexOf('-')>=0; }
    function cells(l){ return l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(c){return c.trim();}); }
    var lines=s.split(/\n/),out=[],inUl=false,i=0;
    while(i<lines.length){ var ln=lines[i];
      // GFM table: a header row immediately followed by a |---|---| separator row
      if(isRow(ln)&&i+1<lines.length&&isSep(lines[i+1])){ if(inUl){out.push('</ul>');inUl=false;}
        var head=cells(ln),body=[]; i+=2; while(i<lines.length&&isRow(lines[i])){ body.push(cells(lines[i])); i++; }
        var th='<tr>'+head.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr>';
        var tr=body.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+c+'</td>';}).join('')+'</tr>';}).join('');
        out.push('<table class="cd-tbl"><thead>'+th+'</thead><tbody>'+tr+'</tbody></table>'); continue; }
      if(/^\s*#{1,4}\s+/.test(ln)){ if(inUl){out.push('</ul>');inUl=false;} out.push('<div class="cd-h">'+ln.replace(/^\s*#{1,4}\s+/,'')+'</div>'); i++; continue; }
      if(/^\s*[-*]\s+/.test(ln)){ if(!inUl){out.push('<ul>');inUl=true;} out.push('<li>'+ln.replace(/^\s*[-*]\s+/,'')+'</li>'); i++; continue; }
      if(inUl){out.push('</ul>');inUl=false;} if(ln.trim())out.push('<p>'+ln+'</p>'); i++; }
    if(inUl)out.push('</ul>'); return out.join(''); }
  function cdRender(){ var root=document.getElementById('cdRoot'); if(!root)return; var pin=cdPinned();
    var mp=CDMODELS.map(function(m){return '<button data-cd="model" data-id="'+m.id+'" class="'+(state.cdModel===m.id?'on':'')+'">'+m.s+'</button>';}).join('');
    var h='<div class="cd-resize" data-cd="resize" title="Drag to resize"></div>'
      +'<div class="cd-head"><div class="av"><img src="'+(window.__BEE__||'')+'" alt="" style="width:100%;height:100%;display:block;object-fit:cover;border-radius:inherit"></div><div style="flex:1;min-width:0"><div class="ti">Report Assistant</div><div class="sub">read-only · grounded in the open report</div></div><div class="cd-mp">'+mp+'</div>'
      +'<button class="cd-ic" data-cd="hist" title="History">☰</button><button class="cd-ic" data-cd="new" title="New chat">+</button><button class="cd-ic" data-cd="close" title="Close">✕</button></div>';
    if(state.cdListOpen){ var rows=(state.cdConvs||[]).map(function(c){return '<div class="row'+(c.id===state.cdConv?' on':'')+'"><span class="t" data-cd="conv" data-id="'+c.id+'">'+esc(c.title)+'</span><button class="cd-ic" data-cd="del" data-id="'+c.id+'" title="Delete">🗑</button></div>';}).join('');
      h+='<div class="cd-list">'+(rows||'<div style="padding:12px 14px;color:var(--muted);font-size:13px">No conversations yet.</div>')+'</div>'; }
    if(pin){ h+='<div class="cd-chip">📄 report: <b>'+esc(pin.label)+'</b><button data-cd="unpin" title="Ask without a report">✕</button></div>'; }
    h+='<div class="cd-body" id="cdBody"></div>';
    var dis=state.cdBusy?' disabled':''; var btn=state.cdBusy?'<button class="cd-send stop" data-cd="stop">Stop</button>':'<button class="cd-send" data-cd="send">Send</button>';
    h+='<div class="cd-foot"><div class="cd-inrow"><textarea class="cd-in" id="cdIn" rows="2" placeholder="'+(pin?'Ask about this report…':'Ask about a report…')+'"'+dis+'></textarea>'+btn+'</div></div>';
    root.innerHTML=h; cdRenderBody();
    // Enter sends, Shift+Enter newlines — BUT never while an IME is composing (e.isComposing / keyCode 229):
    // with a Chinese/Japanese/Korean IME, Enter CONFIRMS the candidate, it must not send a half-composed message.
    var ta=document.getElementById('cdIn'); if(ta&&!state.cdBusy){ ta.focus(); ta.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){ e.preventDefault(); cdSend(); } }); }
  }
  function cdRenderBody(){ var b=document.getElementById('cdBody'); if(!b)return; var pin=cdPinned();
    if(!state.cdMsgs.length){ var sg=pin?['What does this report conclude?','What are the key datapoints?','What should we fix first?']:['What reports do we have so far?','Summarize the latest run'];
      b.innerHTML='<div class="cd-sugg"><div class="h">'+(pin?'Ask about this report':'Suggestions')+'</div>'+sg.map(function(q){return '<button data-cd="sugg" data-q="'+esc(q)+'">'+esc(q)+'</button>';}).join('')+'</div>'; return; }
    var html=state.cdMsgs.map(function(m){ if(m.role==='user')return '<div class="cd-msg user">'+esc(m.text)+'</div>';
      var body=m.text?cdMd(m.text):(m.partial?'<span class="cd-spin"></span>':'');
      return '<div class="cd-msg asst"><div class="b">'+body+'</div></div>'; }).join('');
    if(state.cdBusy&&state.cdStatus)html+='<div class="cd-status"><span class="cd-spin"></span>'+esc(state.cdStatus)+'</div>';
    if(state.cdErr)html+='<div class="cd-err">'+esc(state.cdErr)+'</div>';
    b.innerHTML=html; b.scrollTop=b.scrollHeight;
  }
  function cdLoadConvs(){ api('/api/chat/conversations').then(function(r){return r.json();}).then(function(d){ state.cdConvs=d.conversations||[]; cdRender(); }).catch(function(){}); }
  function cdLoadConv(id){ api('/api/chat/conversations/'+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){ if(d.conversation){ state.cdConv=d.conversation.id; state.cdMsgs=(d.conversation.messages||[]).filter(function(m){return !m.partial;}).map(function(m){return {role:m.role,text:m.text,usage:m.usage};}); state.cdListOpen=false; state.cdErr=null; cdRender(); } }).catch(function(){}); }
  function cdNew(){ state.cdConv=null; state.cdMsgs=[]; state.cdListOpen=false; state.cdErr=null; cdRender(); }
  function cdSend(text){ if(state.cdBusy)return; var ta=document.getElementById('cdIn'); var q=(text||(ta?ta.value:'')||'').trim(); if(!q)return;
    state.cdMsgs.push({role:'user',text:q}); var asst={role:'assistant',text:'',partial:true}; state.cdMsgs.push(asst);
    state.cdBusy=true; state.cdErr=null; state.cdStatus='thinking…'; if(ta)ta.value=''; cdRender();
    var pin=cdPinned(); var body={message:q,model:state.cdModel}; if(state.cdConv)body.convId=state.cdConv; if(pin)body.context={report:{runId:pin.runId}};
    var ac=(typeof AbortController!=='undefined')?new AbortController():null; state.cdAbort=ac;
    fetch('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ac?ac.signal:undefined}).then(function(res){
      if(res.status===428){ state.cdBusy=false; state.cdMsgs.pop(); state.cdMsgs.pop(); return res.json().catch(function(){ return {}; }).then(function(d){ state.cdErr=(d&&d.error)||'Add your Anthropic API key in Settings first.'; cdRender(); return null; }); }
      if(!res.ok||!res.body){ throw new Error('HTTP '+res.status); }
      var reader=res.body.getReader(),dec=new TextDecoder(),buf='';
      function pump(){ return reader.read().then(function(ch){ if(ch.done){ cdFinish(); return; } buf+=dec.decode(ch.value,{stream:true}); var idx; while((idx=buf.indexOf('\n\n'))>=0){ var frame=buf.slice(0,idx); buf=buf.slice(idx+2); cdFrame(frame,asst); } return pump(); }); }
      return pump();
    }).catch(function(e){ if(e&&e.name==='AbortError'){ asst.partial=false; } else { state.cdErr=String(e&&e.message?e.message:e); } cdFinish(); });
  }
  function cdFrame(frame,asst){ var ev=null,data='',lines=frame.split('\n'),i; for(i=0;i<lines.length;i++){ var ln=lines[i]; if(ln.indexOf('event:')===0)ev=ln.slice(6).trim(); else if(ln.indexOf('data:')===0)data+=ln.slice(5).trim(); }
    if(!ev)return; var d={}; try{d=JSON.parse(data);}catch(_){}
    if(ev==='conv'){ if(d.convId)state.cdConv=d.convId; }
    else if(ev==='delta'){ state.cdStatus=null; asst.text+=(d.text||''); cdRenderBody(); }
    else if(ev==='status'){ state.cdStatus=(d.statusKey==='thinking'?'thinking…':(d.statusKey||null)); cdRenderBody(); }
    else if(ev==='done'){ asst.partial=false; if(d.usage)asst.usage=d.usage; }
    else if(ev==='error'){ state.cdErr=d.message||'failed'; asst.partial=false; }
  }
  function cdFinish(){ state.cdBusy=false; state.cdStatus=null; state.cdAbort=null; var last=state.cdMsgs[state.cdMsgs.length-1]; if(last&&last.partial)last.partial=false; cdRender(); }

  // ---------- routing ----------
  var _bootTimer=null;
  function showBoot(){ var b=document.getElementById('bootLoading'); if(b) b.hidden=false; if(_bootTimer)clearTimeout(_bootTimer);
    _bootTimer=setTimeout(hideBoot, 8000); }  // failsafe: if a boot fetch hangs, never mask the app forever
  function hideBoot(){ if(_bootTimer){clearTimeout(_bootTimer);_bootTimer=null;} var b=document.getElementById('bootLoading'); if(b) b.hidden=true; }
  function showPanel(name){
    if(name!=='run'){ state.modalOpen=false; renderNodeModal(); } // don't leak the modal across views
    if(state.memDialog){ state.memDialog=null; renderMemDialog(); }                      // close the high-risk save dialog on any nav
    if(name!=='report'&&state.cdShow) cdClose();   // The Report Assistant is a report-screen overlay — it closes when you leave (the chat is kept)
    if(state.cdInited) cdSyncFab();
    var N=document.querySelectorAll('.navitem');for(var i=0;i<N.length;i++)N[i].className='navitem'+(N[i].getAttribute('data-go')===name?' active':'');
    var P=document.querySelectorAll('.panel');for(var j=0;j<P.length;j++)P[j].className='panel'+(P[j].getAttribute('data-panel')===name?' active':'');
    var sc=document.querySelector('.panel.active');if(sc)sc.scrollTop=0;
    if(name==='run'){ renderRunList(); renderRunDetail(); }
    if(name==='ask'){ renderAskRunList(); renderAskRunDetail(); }   // Quick Ask — history strip + master-detail pane (compose shown only when composing)
    if(name==='report'){ if(state.reportRunId) showReportFrame(); else renderReportList(); }   // open report → frame; else the all-reports grid
    if(name==='memory'){ renderMemory(); }
    if(name==='settings'){ renderSettings(); loadSettings(); }
    renderFirstRun(); renderTelemetryBanner();
    renderTopbar(name);
  }
  // ---------- theme (auto / light / dark; default AUTO — follows OS) ----------
  function themePref(){ try{ var v=localStorage.getItem('theme'); return (v==='light'||v==='dark'||v==='auto')?v:'auto'; }catch(_){ return 'auto'; } }
  function resolveTheme(p){ if(p==='auto') return (window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'; return p==='light'?'light':'dark'; }
  function applyTheme(){ document.body.setAttribute('data-theme', resolveTheme(themePref())); }
  function setTheme(p){ try{ localStorage.setItem('theme',p); }catch(_){} applyTheme(); renderTopbar(currentView()); }
  function themeToggleHtml(){ var p=themePref(); function seg(v,l){ return '<button class="'+(p===v?'on':'')+'" data-act="theme" data-set="'+v+'">'+l+'</button>'; } return seg('auto','Auto')+seg('light','Light')+seg('dark','Dark'); }
  function themeInit(){ applyTheme(); try{ var mq=window.matchMedia('(prefers-color-scheme: dark)'); var f=function(){ if(themePref()==='auto') applyTheme(); }; if(mq.addEventListener)mq.addEventListener('change',f); else if(mq.addListener)mq.addListener(f); }catch(_){} }
  function renderTopbar(view){
    var eb=document.getElementById('ctxEyebrow'),ti=document.getElementById('ctxTitle'),me=document.getElementById('ctxMeta'),ac=document.getElementById('ctxAction'); if(!eb)return;
    var rn=document.getElementById('ctxRun'),rs=document.getElementById('ctxRunStats'),tt=document.getElementById('themeToggle');
    if(tt)tt.innerHTML=themeToggleHtml();
    if(rn){rn.hidden=true;rn.innerHTML='';} if(rs)rs.innerHTML='';
    // Topbar = RUN BAR ONLY (design: no per-page titles). bound to the ROUTE's run (topbarRunId) — the selected
    // scan / open report / open ask — and empty on Connect / Memory / Settings / the Report library, so it
    // never shows an unrelated (or a different live) run's status.
    eb.textContent=''; eb.innerHTML=''; ti.textContent=''; ti.innerHTML=''; me.textContent=''; ac.hidden=true;
    var _tbid=topbarRunId(view,location.search,{activeRunId:state.activeRunId,configOpen:state.configOpen,reportRunId:state.reportRunId,reportFolderRun:state.reportFolderRun,askDetailId:state.askDetailId,askComposing:state.askComposing});
    var _tr=_tbid?runById(_tbid):null;
    var _tbEl=document.querySelector('.ctx-topbar'); if(_tbEl) _tbEl.classList.toggle('no-run',!_tr);
    if(!_tr) return;
    var _trun=runIsLive(_tr);
    // Badge reflects the run's actual state so a FINISHED run never reads as "RUN" (looked like it was still going):
    // live → LIVE RUN, complete → COMPLETE (green), error → FAILED, stopped → STOPPED.
    var _blab=_trun?'LIVE RUN':(_tr.status==='complete'?'COMPLETE':(_tr.status==='error'?'FAILED':(_tr.status==='stopped'?'STOPPED':(_tr.status==='queued'?'QUEUED':'RUN'))));
    eb.innerHTML='<span class="live'+(_trun?'':' done'+(_tr.status==='complete'?' ok':''))+'"><span class="ld"></span>'+_blab+'</span>';   // complete = green (var(--ok)); error/stopped stay amber
    // UI-20: reading a report (/report) the strip is status + cost only — the pipeline stage ("stage 8 / 8 ·
    // Reports") and the title (the reading room shows it right below) are noise there.
    if(view==='report'){ if(rs){ rs.innerHTML='<span><b>'+esc(money(_tr.costUsd))+'</b> spend</span>'; } return; }
    ti.textContent=runTitle(_tr);
    // The 8-stage pipeline bar is for AGENTIC Full Scans only. Quick Ask (and a LEGACY Design Doc / Rec audit run) is
    // NOT 8-stage, so show a simple label + cost instead of a meaningless "stage 1/8 · Comprehend · 58% done".
    if(_tr.kind==='ask'||_tr.kind==='design'||_tr.kind==='audit'){
      if(rn){ var _dl=_tr.kind==='design'?'design doc (legacy)':(_tr.kind==='audit'?'rec audit (legacy)':'quick ask'); rn.innerHTML='<span class="ctx-stage">'+esc(_dl)+'</span>'; rn.hidden=false; }
      if(rs){ rs.innerHTML='<span><b>'+esc(money(_tr.costUsd))+'</b> spend</span>'; }
      return;
    }
    var _ttot=RUN_STAGES.length, _tli, _tlab;
    if(isDeterministicRun(_tr)){ var _tdp=detPipeline(_tr); _ttot=_tdp.total; _tli=_tdp.idx; _tlab=_tdp.label; }   // Deterministic = 2 stages
    else if(_tr.id===state.activeRunId){ _tli=stageIdx(latestStage()); _tlab=stageLabel(latestStage()); }   // active run: precise stage from its live SSE stream
    else if(_tr.status==='complete'){ _tli=_ttot-1; _tlab=stageLabel(RUN_STAGES[_ttot-1].key); }
    else { var _tpp=progressForRun(_tr)||0; _tli=Math.max(0,Math.min(_ttot-1,Math.floor(_tpp/100*_ttot))); _tlab=stageLabel(RUN_STAGES[_tli].key); }   // background/live run not loaded here: estimate stage from its progress (no SSE for it)
    if(rn){ var _td=''; for(var _tdi=0;_tdi<_ttot;_tdi++){ var _tc=_tdi<_tli?'done':(_tdi===_tli?'done now':''); _td+='<span class="ctx-dot '+_tc+'"></span>'; }   // current stage dot pulses (glow) for live AND complete runs — restores the animated marker
      rn.innerHTML='<span class="ctx-dots">'+_td+'</span><span class="ctx-stage">stage '+(_tli+1)+' / '+_ttot+' · '+esc(_tlab)+'</span>'; rn.hidden=false; }
    if(rs){ rs.innerHTML=progressLabel(_tr)+'<span><b>'+esc(money(_tr.costUsd))+'</b> spend</span>'; }
  }
  function currentView(){ var p=location.pathname.replace(/^\/+/,'').split('/')[0]; return (p==='connect'||p==='ask'||p==='run'||p==='report'||p==='memory'||p==='settings')?p:''; }
  function resetRunLanding(){
    if(currentView()==='run'){
      // Master-detail: landing on Full Scan shows the LIST + an empty detail pane — the compose opens only on an
      // explicit action (New), which sets configOpen=true itself. So we do NOT force configOpen here; we only clear
      // any stale run selection.
      state.activeRunId=null;
      state.resumeOpen=null;
      state.resumeError='';
      state.stagePinned=false;
      state.selNode=null;
      state.selBundle=null;
      state.modalOpen=false;
    }
  }
  function applyView(view){
    if(view===''){ history.replaceState(null,'','/connect'); view='connect'; }
    if(view==='run'){
      var ru=runFromUrl();
      if(ru&&runById(ru)){ state.activeRunId=ru; state.configOpen=false; state.resumeOpen=null; state.resumeError=''; attachDetailStream(ru); }
      else if(!ru || state.runs.length) resetRunLanding();
    }
    showPanel(view);
    if(view==='ask') loadRepos('ask');
  }
  function go(view){ var url='/'+view; if(view==='run'){ if(location.pathname+location.search!==url) history.pushState(null,'',url); } else if(url!==location.pathname) history.pushState(null,'',url); closeConnPanel(true); applyView(view); }
  // ---- New chooser (Quick Ask vs Full Scan) — opened from the sidebar "New" button ----
  // Each option's cost hint is derived from your RECENT ACTUALS (recentCostHint over state.runs), else the typical
  // range — never a hard-coded guess dressed up as a measurement.
  function openChooser(){ var el=document.getElementById('newChooser'); if(!el) return;
    [['ncCostAsk','ask'],['ncCostScan','scan']].forEach(function(p){ var sp=document.getElementById(p[0]); if(!sp) return; var h=recentCostHint(state.runs,p[1]); sp.textContent=h?(' · '+h):(' · typically '+TYPICAL_COST[p[1]]); });
    el.hidden=false; }
  function closeChooser(){ var el=document.getElementById('newChooser'); if(el) el.hidden=true; }
  window.addEventListener('popstate',function(){
    // Back/forward into /report: re-open the report the URL names (state may still hold a different one).
    if(currentView()==='report'){ if(!applyReportUrl()){ state.reportRunId=null; state.reportKind=null; state.reportFolderRun=null; } }
    applyView(currentView());
  });

  // ---------- boot (single-user, no login) ----------
  function startApp(){ showBoot();
    // Only a session that LANDS on /report has a deep link to protect; everywhere else the URL sync can start
    // immediately (else a session starting on /run|/connect never gets shareable report URLs).
    if(currentView()!=='report') state.reportUrlApplied=true;
    loadState().then(hideBoot,hideBoot); loadSettings(); applyView(currentView()); cdInit(); }

  // ---------- Settings: API keys · per-run spending cap · telemetry ----------
  function loadSettings(){
    return api('/api/settings').then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(function(d){
      state.settings=d||{}; state.settingsErr='';
      if(d&&d.runBudget!=null){ state.runBudget=d.runBudget; state.effectiveRunBudget=(d.effectiveRunBudget!=null?d.effectiveRunBudget:state.effectiveRunBudget); }
      if(state.saveKeys==null) state.saveKeys=!!(d&&d.keys&&d.keys.savedOnMachine);
      var fv=document.getElementById('footVersion'); if(fv) fv.textContent=(d&&d.version)?('v'+String(d.version).replace(/^v/,'')):(APP_VERSION?'v'+APP_VERSION.replace(/^v/,''):'');
      renderSettings(); renderFirstRun(); renderTelemetryBanner(); renderAskGate();
      if(state.configOpen&&currentView()==='run') renderRunDetail();
    }).catch(function(e){ state.settingsErr='Could not load settings ('+(e&&e.message?e.message:'network error')+').'; renderSettings(); });
  }
  function postJson(url,body){ return api(url,{method:'POST',body:body}).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return {ok:r.ok,status:r.status,d:d||{}}; }); }); }
  // Save the Anthropic / OpenAI keys from a key form (Settings, or the first-run prompt with prefix 'fr'). An empty
  // field is left out (unchanged); Clear sends '' for that one key. The "Save keys on this machine" tick rides along.
  function saveKeys(prefix,clearWhich){
    var body={}; var a=document.getElementById(prefix+'Anthropic'), o=document.getElementById(prefix+'OpenAI'), sv=document.getElementById(prefix+'SaveKeys');
    if(clearWhich){ body[clearWhich]=''; }
    else {
      var av=a?a.value.trim():'', ov=o?o.value.trim():'';
      if(av) body.anthropic=av; if(ov) body.openai=ov;
      if(!av&&!ov&&(!sv||prefix==='fr')){ state.keyMsg='Paste a key first.'; renderKeyMsg(); return; }

    }
    if(sv){ body.save=!!sv.checked; state.saveKeys=!!sv.checked; }
    state.keyMsg='Saving…'; renderKeyMsg();
    postJson('/api/settings/keys',body).then(function(res){
      if(!res.ok){ state.keyMsg=humanError(res.d.error,'Could not save the keys.'); renderKeyMsg(); return; }
      if(state.settings) state.settings.keys=res.d.keys; else state.settings={keys:res.d.keys};
      state.keyMsg=clearWhich?'Cleared.':'Saved.';
      if(a) a.value=''; if(o) o.value='';
      renderSettings(); renderFirstRun(); renderAskGate(); if(state.configOpen&&currentView()==='run') renderRunDetail();
    }).catch(function(){ state.keyMsg='Network error.'; renderKeyMsg(); });
  }
  function renderKeyMsg(){ ['setKeyMsg','frKeyMsg'].forEach(function(id){ var m=document.getElementById(id); if(m) m.textContent=state.keyMsg||''; }); }
  function saveBudget(){
    var inp=document.getElementById('setBudget'); var v=inp?Number(inp.value):NaN;
    if(!(v>0)){ state.budgetMsg='Enter a dollar amount.'; renderSettings(); return; }
    state.budgetMsg='Saving…'; renderSettings();
    postJson('/api/settings/budget',{usd:v}).then(function(res){
      if(!res.ok){ state.budgetMsg=humanError(res.d.error,'Could not save the cap.'); renderSettings(); return; }
      state.runBudget=res.d.runBudget; state.effectiveRunBudget=res.d.effectiveRunBudget;
      if(state.settings){ state.settings.runBudget=res.d.runBudget; state.settings.effectiveRunBudget=res.d.effectiveRunBudget; }
      state.budgetMsg='Saved — applies to new runs.'; renderSettings();
    }).catch(function(){ state.budgetMsg='Network error.'; renderSettings(); });
  }
  function setConnections(remember){
    state.connMsg='Saving…'; renderSettings();
    postJson('/api/settings/connections',{remember:!!remember}).then(function(res){
      if(!res.ok){ state.connMsg=humanError(res.d.error,'Could not save.'); renderSettings(); return; }
      if(state.settings) state.settings.connections=res.d.connections||{remember:!!remember};
      state.connMsg='Saved.'; renderSettings();
    }).catch(function(){ state.connMsg='Network error.'; renderSettings(); });
  }
  function setTelemetry(body){

    state.telemetryMsg='Saving…'; renderSettings();
    postJson('/api/settings/telemetry',body).then(function(res){
      if(!res.ok){ state.telemetryMsg=humanError(res.d.error,'Could not save.'); renderSettings(); return; }
      if(state.settings&&state.settings.telemetry&&res.d.telemetry){ for(var k in res.d.telemetry){ if(Object.prototype.hasOwnProperty.call(res.d.telemetry,k)) state.settings.telemetry[k]=res.d.telemetry[k]; } }
      state.telemetryMsg='Saved.'; renderSettings(); renderTelemetryBanner();
    }).catch(function(){ state.telemetryMsg='Network error.'; renderSettings(); });
  }
  // One key form, shared by Settings (prefix 'set', both keys) and the first-run prompt (prefix 'fr', Anthropic only).
  function keyFormHtml(prefix,keys,full){
    keys=keys||{}; var ak=keys.anthropic||{set:false}, ok=keys.openai||{set:false};
    function status(k,which,required){
      if(!k.set) return '<div class="set-status"><span class="sbadge '+(required?'warn':'info')+'">not set</span>'+(which==='anthropic'&&keys.claudeLogin?' <span class="set-src">using the Claude Code login found on this machine</span>':'')+'</div>';
      return '<div class="set-status"><span class="sbadge ok">set</span> <span class="mono set-hint">'+esc(k.hint||'')+'</span> <span class="set-src">'+esc(keySourceText(k))+'</span>'
        +'<button type="button" class="btn ghost set-clear" data-act="key-clear" data-key="'+which+'" data-prefix="'+prefix+'">Clear</button></div>';
    }
    var h='<form class="set-keys" id="'+prefix+'KeyForm" autocomplete="off" onsubmit="return false">'
      +'<div class="field"><label for="'+prefix+'Anthropic">Anthropic API key <span class="set-req">required</span></label>'
      +'<input id="'+prefix+'Anthropic" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="'+(ak.set?'paste a new key to replace it':'sk-ant-api… (API key)  ·  or  sk-ant-oat… (Claude plan token)')+'"></div>'
      +status(ak,'anthropic',true);
    if(full){
      h+='<div class="field" style="margin-top:14px"><label for="'+prefix+'OpenAI">OpenAI API key <span class="set-opt">optional</span></label>'
        +'<input id="'+prefix+'OpenAI" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="'+(ok.set?'paste a new key to replace it':'sk-…')+'"></div>'
        +status(ok,'openai',false)
        +'<p class="hint">Report writing, report quality checks and translation use OpenAI when this key is present, and fall back to Claude when it is not.</p>';
    }
    var save=(state.saveKeys==null)?!!keys.savedOnMachine:state.saveKeys;
    h+='<label class="set-check"><input type="checkbox" id="'+prefix+'SaveKeys"'+(save?' checked':'')+'> Save keys on this machine</label>'
      +'<p class="hint" style="margin-top:2px">Stored in <code class="mono">&lt;data dir&gt;/keys.json</code> (file mode 0600). Unticked, keys live in memory only and are gone when the app restarts. A key set in the environment (<code class="mono">.env</code>) is never written to disk.</p>'
      +'<div class="set-row"><button type="button" class="btn honey" data-act="keys-save" data-prefix="'+prefix+'">Save key'+(full?'s':'')+'</button><span class="mono set-msg" id="'+prefix+'KeyMsg">'+esc(state.keyMsg||'')+'</span></div>'
      +'</form>';
    return h;
  }
  var BILLING_NOTE='All usage bills your own API keys. Keys are only sent to Anthropic / OpenAI.';
  function renderSettings(){
    var host=document.getElementById('settingsBody'); if(!host) return;
    var s=state.settings;
    if(!s){ host.innerHTML='<div class="set-wrap"><h1 class="set-title">Settings</h1>'+(state.settingsErr?'<div class="rd-card">'+esc(state.settingsErr)+'</div>':'<div class="hint">Loading…</div>')+'</div>'; return; }
    var keys=s.keys||{}, tel=s.telemetry||{};
    var cap=(s.runBudget!=null?s.runBudget:state.runBudget);
    var eff=(s.effectiveRunBudget!=null?s.effectiveRunBudget:state.effectiveRunBudget);
    var h='<div class="set-wrap">'
      +'<div class="set-headrow"><h1 class="set-title">Settings</h1><span class="mono set-ver">accel-scope'+(s.version?' v'+esc(String(s.version).replace(/^v/,'')):'')+'</span></div>';
    // API keys
    h+='<section class="rd-card set-sec" id="setKeys"><div class="set-sec-h"><h2>API keys</h2><span class="sbadge '+(keys.ready?'ok':'warn')+'">'+(keys.ready?'ready':'Anthropic key needed')+'</span></div>'
      +'<p class="set-lead"><b>'+esc(BILLING_NOTE)+'</b></p>'
      +'<p class="hint" style="margin-top:0">Using: '+esc(providerText(keys.provider))+'.</p>'
      +keyFormHtml('set',keys,true)+'</section>';
    // Spending
    h+='<section class="rd-card set-sec" id="setBudgetSec"><div class="set-sec-h"><h2>Spending</h2></div>'
      +'<div class="field"><label for="setBudget">Per-run cap (USD)</label><div class="set-row"><span class="set-dollar">$</span><input id="setBudget" type="number" min="1" step="1" inputmode="decimal" value="'+esc(cap!=null?String(cap):'20')+'" style="max-width:160px"><button type="button" class="btn honey" data-act="budget-save">Save cap</button><span class="mono set-msg">'+esc(state.budgetMsg||'')+'</span></div></div>'
      +'<p class="hint">Each Quick Ask and Full Scan stops starting new work once it reaches this cap (default $20). Typical costs: Quick Ask ~$0.3–1, Full Scan ~$5–30.'+(eff===0?' The cap is currently not enforced (0 = unbounded).':(eff!=null&&cap!=null&&Number(eff)!==Number(cap)?' Enforced cap right now: '+esc(usd(eff))+'.':''))+'</p></section>';
    // Connections: remember connector credentials across restarts (off = memory only)
    var remember=!!(s.connections&&s.connections.remember);
    h+='<section class="rd-card set-sec" id="setConnections"><div class="set-sec-h"><h2>Connections</h2><span class="sbadge '+(remember?'ok':'info')+'">'+(remember?'remembered':'memory only')+'</span></div>'
      +'<label class="set-check"><input type="checkbox" id="setRememberConn"'+(remember?' checked':'')+'> Remember connection credentials on this machine</label>'
      +'<p class="hint">Off (default): GitHub tokens, MCP tokens and BigQuery keys stay in memory only — after a restart their sources show <b>Reconnect</b> on the Connect tab. On: they are written to <code class="mono">&lt;data dir&gt;/credentials.json</code> with file mode 0600 (never to <code class="mono">state.json</code>).</p>'
      +'<span class="mono set-msg">'+esc(state.connMsg||'')+'</span></section>';
    // Telemetry
    var fields=(tel.fields||[]).map(function(f){ return '<li><code class="mono">'+esc(f.name)+'</code> — '+esc(f.description||'')+'</li>'; }).join('');
    var ex=''; try{ ex=JSON.stringify(tel.example||{},null,2); }catch(_){ ex=''; }
    h+='<section class="rd-card set-sec" id="setTelemetry"><div class="set-sec-h"><h2>Anonymous usage telemetry</h2><span class="sbadge '+(tel.enabled?'ok':'info')+'">'+(tel.enabled?'on':'off')+'</span></div>'
      +(tel.notice?'<p class="set-lead">'+esc(tel.notice)+'</p>':'')
      +'<label class="set-check'+(tel.envDisabled?' disabled':'')+'"><input type="checkbox" id="setTelemetryOn"'+(tel.enabled?' checked':'')+(tel.envDisabled?' disabled':'')+'> Send anonymous usage telemetry</label>'
      +(tel.envDisabled?'<p class="hint">Turned off by the environment (<code class="mono">THERESA_TELEMETRY=0</code>), so this switch is disabled.</p>':'<p class="hint">Set <code class="mono">THERESA_TELEMETRY=0</code> in the environment to turn it off for good. Start the app with <code class="mono">--print-telemetry</code> to print each payload as it is sent.</p>')
      +'<span class="mono set-msg">'+esc(state.telemetryMsg||'')+'</span>'
      +(fields?'<div class="set-sub">What is sent</div><ul class="set-fields">'+fields+'</ul>':'')
      +(ex?'<div class="set-sub">Example payload</div><pre class="set-pre">'+esc(ex)+'</pre>':'')
      +(tel.installId?'<p class="hint">Anonymous install id: <code class="mono">'+esc(tel.installId)+'</code></p>':'')
      +'</section>';
    h+='</div>';
    host.innerHTML=h;
  }
  // FIRST RUN: no Claude credential yet → a full-width card above every tab with the same key form (inline save).
  function renderFirstRun(){
    var host=document.getElementById('firstRun'); if(!host) return;
    var show=keysMissing()&&currentView()!=='settings';
    host.hidden=!show; if(!show){ host.innerHTML=''; return; }
    host.innerHTML='<div class="fr-head"><span class="fr-ico" aria-hidden="true">✦</span><div><div class="fr-title">Add your Anthropic API key to get started</div>'
      +'<div class="fr-sub">accel-scope runs its agents on your own key. Quick Ask and Full Scan stay disabled until a key is set. '+esc(BILLING_NOTE)+' <a href="/settings" data-act="go-settings">More options in Settings</a></div></div></div>'
      +keyFormHtml('fr',(state.settings&&state.settings.keys)||{},false);
  }
  // Telemetry notice: shown once (until OK / Turn off) while telemetry is on.
  function renderTelemetryBanner(){
    var host=document.getElementById('teleBanner'); if(!host) return;
    var t=state.settings&&state.settings.telemetry;
    var show=!!(t&&t.enabled&&!t.noticeShown);
    host.hidden=!show; if(!show){ host.innerHTML=''; return; }
    host.innerHTML='<span class="tb-txt">accel-scope sends anonymous usage counts (run type, duration, cost range, finding counts) to help improve it &mdash; never your code, questions, findings or keys. <a href="/settings" data-act="go-settings">What is sent?</a></span>'
      +'<span class="tb-btns"><button type="button" class="btn honey" data-act="telemetry-ok">OK</button><button type="button" class="btn ghost" data-act="telemetry-off">Turn off</button></span>';
  }
  // The message under a blocked Quick Ask / Full Scan (no Anthropic key yet).
  function keyGateHtml(){ return '<div class="key-gate" role="alert">Add your Anthropic API key before starting a run — <a href="/settings" data-act="go-settings">open Settings</a>.</div>'; }
  // The per-run cap line on the New Full Scan / Quick Ask forms.
  function capLineHtml(){ var c=state.effectiveRunBudget!=null?state.effectiveRunBudget:state.runBudget; return '<span class="cap-line">Per-run cap: <b>'+(c===0?'none':(c!=null?esc(usd(c)):'—'))+'</b> · <a href="/settings" data-act="go-settings">change in Settings</a></span>'; }

  // ---------- state / connectors ----------
  function loadState(){ return api('/api/state').then(function(r){return r.json();}).then(function(d){ state.sources=d.sources||[]; state.actingOrgId=d.actingOrgId; state.runBudget=(d.runBudget!=null?d.runBudget:null); state.effectiveRunBudget=(d.effectiveRunBudget!=null?d.effectiveRunBudget:null); state.openaiAuthOk=(typeof d.openaiAuthOk==='boolean'?d.openaiAuthOk:null); renderConnectors(); renderLocalConnected(); renderGiturlConnected(); ensureArtDefaults(); renderRuns(d.runs||[]); renderTopbar(currentView()); renderAskGate(); if(state.askComposing) renderAskPlanes(); if(currentView()==='report'){ if(!state.reportUrlApplied&&applyReportUrl()){ state.reportUrlApplied=true; } else { state.reportUrlApplied=true; if(state.reportRunId) renderReportToggle(); else renderReportList(); } } else { state.reportUrlApplied=true; } if(currentView()==='memory'){ renderMemory(); } }); }
  function srcMono(kind){ return {github:'GH',giturl:'URL',warehouse:'SQL',keyvalue:'KV',local:'DIR',bi:'BI',docs:'DT',mcp:'MCP',analytics:'MCP',custom:'MCP'}[kind]||'··'; }   // readable monograms: 'MCP' for the Data MCPs row, 'URL'/'DIR'/'SQL' instead of cryptic letters
  function srcCard(name,line,kind,connected,badge,status){
    var sel=state.pick===kind?' pick':'';
    var err=connected&&status==='error';   // source exists but its session credential wasn't persisted across restart
    var on=connected&&!err?' on':'';
    var accent=err?'var(--high)':(connected?'var(--ok)':'var(--line)');
    return '<button class="src-card'+on+sel+'" data-pick="'+kind+'" style="border-left:3px solid '+accent+'">'
      +'<span class="src-mono">'+srcMono(kind)+'</span>'
      +'<span class="src-body"><span class="src-name">'+esc(name)+'</span><span class="src-line">'+esc(line)+'</span></span>'
      +'<span class="sbadge '+(err?'warn':(connected?'ok':'info'))+'">'+esc(err?'reconnect':(connected?'connected':badge))+'</span></button>';
  }
  // Connect state for a source KIND: connected (ready) / reconnect (credential lapsed) / available (not connected).
  // 'giturl' needs no special case — it falls through to the generic srcByKind branch, same as any
  // credential-less accumulating source (mirrors 'local').
  function connState(kind){
    if(kind==='mcp'){ var m=(state.sources||[]).filter(function(s){return s.kind==='analytics'||s.kind==='bi'||s.kind==='custom';}); if(!m.length)return 'available'; return m.some(function(s){return s.status==='error';})?'reconnect':'connected'; }
    if(kind==='docs') return 'later';
    var s=srcByKind(kind); if(!s)return 'available'; return s.status==='error'?'reconnect':'connected';
  }
  // One source ROW inside a category card. Returns {html, st}. Clicking opens the slide-over connect panel (data-pick).
  function connRow(kind,name,def){
    var st=connState(kind);
    var sub, rawDetail='';
    if(kind==='mcp'){ var m=(state.sources||[]).filter(function(s){return s.kind==='analytics'||s.kind==='bi'||s.kind==='custom';}); sub=m.length?(m.length+' plane'+(m.length===1?'':'s')+' · '+m.slice(0,2).map(function(s){return s.mcpName||s.name;}).join(', ')):def; }
    else { var s=srcByKind(kind); sub=(s&&s.detail)?(friendlySourceDetail(s.detail)||def):def; rawDetail=(s&&s.detail)||''; }   // No secret names / server paths on the tile
    var cls=(st==='connected'||st==='reconnect')?st:'';
    var actTxt=st==='connected'?'Manage':(st==='reconnect'?'Reconnect':'Connect');
    var html='<button class="cx-row" data-pick="'+kind+'"'+(rawDetail?' title="'+esc(rawDetail)+'"':'')+'>'
      +'<span class="cx-badge '+cls+'">'+srcMono(kind)+'</span>'
      +'<span class="cx-row-main"><span class="cx-row-name">'+esc(name)+'</span><span class="cx-row-sub">'+esc(sub)+'</span></span>'
      +'<span class="cx-dot '+cls+'"></span><span class="cx-act '+(st==='reconnect'?'reconnect':'')+'">'+actTxt+'</span></button>';
    return {html:html, st:st};
  }
  function connCard(lab, items){
    var recon=items.filter(function(x){return x.st==='reconnect';}).length;
    var ct=items.length+(recon?' <span style="color:var(--high)">· reconnect</span>':'');
    return '<div class="cx-card"><div class="cx-card-head"><span class="lab">'+esc(lab)+'</span><span class="ct">'+ct+'</span></div>'+items.map(function(x){return x.html;}).join('')+'</div>';
  }
  function renderConnectors(){
    var grid=document.getElementById('connGrid'), sum=document.getElementById('connSummary');
    var kinds=['github','giturl','local','warehouse','mcp','keyvalue'];
    var connected=0,recon=0,avail=0;
    kinds.forEach(function(k){var st=connState(k); if(st==='connected')connected++; else if(st==='reconnect')recon++; else avail++;});
    if(sum) sum.innerHTML='<div class="cx-stat"><span class="n">'+connected+'</span><span class="k">connected</span></div><div class="cx-sep"></div>'
      +'<div class="cx-stat"><span class="n">'+recon+'</span><span class="k">reconnect</span></div><div class="cx-sep"></div>'
      +'<div class="cx-stat"><span class="n">'+avail+'</span><span class="k">available</span></div>'
      +'<div class="cx-ro"><span class="d"></span><span class="t">read-only</span></div>';
    if(!grid)return;
    var code=connCard('Code',[connRow('github','GitHub','Repositories, read-only token.'),connRow('giturl','Public GitHub URL','paste a URL — no auth'),connRow('local','Local code','a folder on this machine')]);
    var data=connCard('Data planes',[connRow('warehouse','Warehouse SQL','BigQuery · read-only'),connRow('mcp','Data MCPs','Amplitude / Metabase / dashboards'),connRow('keyvalue','Key-value','Redis / cache (MCP)')]);
    grid.innerHTML=code+data;
  }
  // Slide-over connect panel (opens when a source row is clicked; selectSource populates the form inside).
  // The drawer is a real dialog — focus moves INTO it on open (its close button, so the next Tab lands on the first
  // field) and returns to the row that opened it on close; Esc closes it (keydown handler below). Switching rows while
  // it is open keeps the ORIGINAL opener as the return target.
  function openConnPanel(){ var b=document.getElementById('connBackdrop'),p=document.getElementById('connPanel');
    var wasOpen=!!(p&&p.style.display==='flex');
    if(!wasOpen){ var ae=document.activeElement; state.connReturnFocus=(ae&&ae!==document.body)?ae:null; }
    if(b)b.style.display='block'; if(p){ p.style.display='flex'; var tb=document.querySelector('.ctx-topbar'); if(tb){ p.style.top=(tb.getBoundingClientRect().bottom+28)+'px'; } } document.body.classList.add('conn-panel-open');
    var x=p&&p.querySelector('.cx-panel-x'); if(x){ try{ x.focus(); }catch(_){} } }
  function closeConnPanel(noRefocus){ var b=document.getElementById('connBackdrop'),p=document.getElementById('connPanel'); var wasOpen=!!(p&&p.style.display==='flex');
    if(b)b.style.display='none'; if(p)p.style.display='none'; document.body.classList.remove('conn-panel-open');
    var rf=state.connReturnFocus; state.connReturnFocus=null;
    if(noRefocus) return;
    if(wasOpen&&rf&&rf.focus&&document.body.contains(rf)){ try{ rf.focus(); }catch(_){} }
    else if(wasOpen){ var pk=document.querySelector('.cx-row[data-pick="'+cssq(state.pick)+'"]'); if(pk){ try{ pk.focus(); }catch(_){} } } }
  var SRC_META={
    github:{k:'SOURCE · GITHUB',t:'Connect GitHub',b:'Paste a read-only personal access token to list and clone your repositories over HTTPS. Read-only — nothing is ever pushed.'},
    local:{k:'SOURCE · LOCAL CODE',t:'Add local code',b:'Point at a folder on this machine, or upload one from your browser — read-only. An upload is copied as a snapshot for the scan (node_modules, .git, and build output are skipped); nothing is written back. Add more folders anytime; pick which to scan in New Full Scan or Quick Ask.'},
    giturl:{k:'SOURCE · PUBLIC GITHUB URL',t:'Scan a public GitHub repo by URL',b:'Paste one or more PUBLIC github.com repo URLs (one per line) — no token needed. Each is cloned read-only over HTTPS at run time. Only public github.com repos work; a private/unknown repo is skipped. Pick which to scan in New Full Scan or Quick Ask.'},
    warehouse:{k:'SOURCE · WAREHOUSE SQL',t:'Connect Warehouse SQL',b:'BigQuery, read-only — paste a service-account key JSON (give it read-only roles), or point at a warehouse MCP server. Lets findings compute real metric values, not guesses.'},
    keyvalue:{k:'SOURCE · KEY-VALUE (READ-ONLY)',t:'Connect a key-value plane',b:'A read-only Redis/cache plane over MCP — lets the Expert step measure things that live in the serving cache, not the warehouse: candidate-pool & set sizes (ZCARD), set membership, key freshness.'},
    mcp:{k:'SOURCE · DATA MCPs',t:'Connect a read-only data MCP',b:'Mount any read-only MCP into your runs — Amplitude (product analytics), Metabase / a BI tool, a product dashboard, a custom data plane. The agent gets ONLY the tools you allowlist, read-only. Run the MCP server (locally or hosted), paste its URL; connect more than one.'},
    docs:{k:'SOURCE · DOCS & TICKETS',t:'Docs & tickets',b:'Notion / Linear / Atlassian context for provenance. Coming later.'}
  };
  function selectSource(kind){
    state.pick=kind;
    var m=SRC_META[kind]||{k:'SOURCE',t:'Add a connection',b:''};
    var setT=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
    setT('connKicker',m.k); setT('connTitle',m.t); setT('connBody',m.b);
    var show=function(id,on){var e=document.getElementById(id);if(e)e.style.display=on?'block':'none';};
    show('ghFields',kind==='github'); show('whFields',kind==='warehouse'); show('kvFields',kind==='keyvalue');
    show('mcpFields',kind==='mcp'); if(kind==='mcp')fillMcpList();
    show('giturlFields',kind==='giturl'); if(kind==='giturl')renderGiturlConnected();
    show('localFields',kind==='local'); if(kind==='local')renderLocalConnected();
    var later=(kind==='bi'||kind==='docs'); show('laterNote',later);
    var cr=document.getElementById('connectRow'); if(cr) cr.style.display=(later||(kind==='local'&&!LOCALAUDIT))?'none':'flex';   // local uses its own Upload button unless path mode is on
    var src=srcByKind(kind);
    if(kind==='mcp'){ var _ms=(state.sources||[]).filter(function(s){return (s.kind==='analytics'||s.kind==='bi'||s.kind==='custom')&&s.status==='error';}); if(_ms.length) setT('connBody','Reconnect needed: '+_ms.map(function(s){return s.mcpName||s.name;}).join(', ')+' — the token was not saved on this machine. Paste the token(s) again and Connect. '+m.b); }
    else if(src&&src.status==='error') setT('connBody','Reconnect needed — '+(src.detail||'the credential was not saved on this machine')+'. Enter the credential again below and Connect (Settings → Connections can remember credentials across restarts). '+m.b);
    var dc=document.getElementById('connDisconnect');

    if(dc){ if(src){ dc.style.display='block'; dc.innerHTML='<button data-act="disconnect" data-id="'+esc(src.id)+'" data-name="'+esc(m.t)+'" style="font-size:12.5px;color:#B3401F;background:var(--cream-card);border:1px solid var(--line);border-radius:8px;padding:6px 11px;cursor:pointer">Disconnect '+esc(sourceKindLabel(kind))+'</button>'; } else { dc.style.display='none'; dc.innerHTML=''; } }
    renderConnectors();
  }

  // ---------- target: every connected source's artifacts ----------
  function allArtifactKeys(){ var ks=[]; state.sources.forEach(function(s){ (s.artifacts||[]).forEach(function(a){ ks.push(s.id+'::'+a.id); }); }); return ks; }
  // NOTHING is pre-ticked — code artifacts, data planes and memory recall all start OFF; your LAST RUN
  // selection (localStorage, restoreScanSel drops ids no longer connected) is re-applied.
  // Re-seeds only when the connected set changes, so in-form ticks survive re-renders.
  function ensureArtDefaults(){
    var srcs=state.sources.filter(function(s){ return (s.artifacts||[]).length; });
    var pc=planeChoices(state.sources);
    var key=(state.actingOrgId||'')+'#'+srcs.map(function(s){ return s.id+':'+(s.artifacts||[]).map(function(a){return a.id;}).join(','); }).join('|')
      +'#'+pc.planes.map(function(p){return p.id;}).join(',');
    if(key!==state._selKey){
      var saved=null; try{ var raw=window.localStorage.getItem(scanSelStorageKey(state.actingOrgId)); saved=raw?JSON.parse(raw):null; }catch(_){ saved=null; }
      var r=restoreScanSel(saved, allArtifactKeys(), pc.planes.map(function(p){return p.id;}));
      state.artSel=r.art; state.planeSel=r.planes; state.memRecall=r.memoryRecall; state.scanConfirm=false;
      state._selKey=key;
    }
  }
  function rememberScanSel(){ try{ window.localStorage.setItem(scanSelStorageKey(state.actingOrgId), JSON.stringify(snapshotScanSel(state.artSel,state.planeSel,state.memRecall))
); }catch(_){} }
  function runFromUrl(){ try { return new URLSearchParams(location.search).get('run') || null; } catch(_) { return null; } }
  function runById(id){ for(var i=0;i<state.runs.length;i++) if(state.runs[i].id===id) return state.runs[i]; return null; }
  function activeRun(){ return runById(state.activeRunId); }
  // 'queued' is admitted-but-parked (no worker, no live output) — NOT live. Excluded so barRun/topbar don't
  // mislabel a promoter-queued run as an actively-running one.
  function runIsLive(r){ return r && r.status!=='queued' && r.status!=='complete' && r.status!=='error' && r.status!=='stopped' && r.status!=='config'; }
  // (The topbar's run is chosen by topbarRunId in SHELL_HELPERS_JS — the route's run — not "any live run".)
  function statusCls(status){ return status==='complete'?'ok':(status==='error'?'err':'warn'); }
  function statusBadge(status){ return '<span class="sbadge '+statusCls(status)+'">'+esc(status||'unknown')+'</span>'; }
  function money(n){ return n==null?'—':('$'+Number(n).toFixed(2)); }
  // relTime (history-card timestamps) lives in SHELL_HELPERS_JS (one locale, year when old).
  function stageIdx(key){ for(var i=0;i<RUN_STAGES.length;i++) if(RUN_STAGES[i].key===key) return i; return 0; }
  function stageLabel(key){ for(var i=0;i<RUN_STAGES.length;i++) if(RUN_STAGES[i].key===key) return RUN_STAGES[i].label; return 'Comprehend'; }
  // Clean, short title — never the run brief (the user's NL input gets its own
  // block in the run detail + report; cramming it into the title overflowed everywhere).
  // A user-edited title (r.renamed) wins over the generated/target title. Independent of r.alias
  //, which relabels the id, NOT the title.
  // runTitle lives in SCAN_FORM_HELPERS_JS (it repairs legacy "1 repos" target names; unit-tested there).
  // HH:MM:SS (local) from an epoch-ms; '' when there's no timestamp (a pre-existing run's replayed line).
  function fmtTime(t){ return fmtEventTime(t); }   // The console's 12-hour en-US clock (was a 24h "16:24:52")
  // Persist a run TITLE override (r.renamed). Empty/blank CLEARS it (reverts to the generated title).
  // Re-render whichever context the inline title editor lives in: the run list (Full Scan), or the Report tab's
  // card (all-reports list) / header (viewing a report). Shared by the run list + report card + report header.
  function rerenderTitleEditContext(){
    if(currentView()==='report'){ renderTopbar('report'); if(!state.reportRunId) renderReportList(); }
    else renderRunList();
  }
  function saveRunTitle(id){
    if(!id) return;
    var inp=document.querySelector('.run-title-input'); var val=inp?String(inp.value||'').trim():'';
    api('/api/runs/'+encodeURIComponent(id)+'/title',{method:'POST',body:{title:val}}).then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var run=runById(id); if(run){ run.renamed=(d&&typeof d.renamed==='string'&&d.renamed)?d.renamed:undefined; }
      state.editingTitleRunId=null; rerenderTitleEditContext();
    }).catch(function(){ state.editingTitleRunId=null; rerenderTitleEditContext(); });
  }
  // The ONLY thing that advances the pipeline stage is an anchored "stage:<key>" marker the backend emits
  // at each phase boundary. Interleaved tool/agent lines (e.g. "▶ critique · scanning … evidence-seeded …")
  // are detail WITHIN the current stage, NOT a transition — so they can't false-jump the timeline forward
  // (the old keyword heuristics did: "evidence-seeded" matched the findings /evidence/ rule).
  function anchoredStage(line){
    // Anchored ONLY at line-start (modulo leading whitespace/▶) — the backend always emits markers there.
    // So free agent text interpolated into detail lines (problem titles, hypothesis claims) that happens
    // to contain "stage:expert" mid-line can't false-advance the timeline.
    // Tolerate an optional leading "[bundle-id] " tag — the per-bundle pipeline prefixes its log lines.
    var m=String(line||'').match(/^[\s▶]*(?:\[[a-z0-9-]+\]\s*)?stage:(comprehend|critique|preflight|expert|mitigate|synthesize|findings|report)\b/i);
    return m ? m[1].toLowerCase() : null;
  }
  // Comprehend announces which expert bundles it activated: "… bundles: recsys-mle, baseline · …".
  // Parse them so the graph shows ONLY the activated Critic/Expert lanes (and none until Comprehend decides).
  function parseBundlesLine(line){
    var m=String(line||'').match(/\bbundles:\s*([a-z0-9,\s-]+?)(?:\s·|$)/i);
    if(!m) return null;
    var keys=m[1].split(/[,\s]+/).map(function(s){return s.trim().toLowerCase();}).filter(Boolean);
    return keys.length?keys:null;
  }
  function eventKind(line){
    var l=String(line||'').toLowerCase();
    if(String(line||'').indexOf('⟳ reused')>=0||String(line||'').indexOf('⟳ lane reused')>=0||String(line||'').indexOf('⟳ lane revived')>=0) return 'reused';   // checkpoint replay lines (resume) — styled as cached, never as tool/error
    if(/(?:^|\s)error:|interrupted by|reply unparseable|failed \(/.test(l)) return 'error';   // real system errors only — NOT a problem text that merely contains the word "failed"/"error"
    if(/verify|confirmed|refuted/.test(l)) return 'verify';
    if(/read |grep|glob|mcp__|clone|query|scanning|iam|warehouse/.test(l)) return 'tool';
    return 'run';
  }
  // Stateful: called once per appended event, in order. Advances state.detailStageNow only on an anchored
  // marker (monotonic — never backward); every line is bucketed under the current stage for per-node detail.
  function parseRunEvent(line,idx,t){
    if(t===undefined) t=Date.now();   // synthetic UI events (done/stopped/error) have no backend time → now; replay/tail pass an epoch-ms, or null for a pre-existing run with no recorded time
    var raw=String(line||'');
    // Per-bundle pipeline tags each line "[bundle-id] …" — capture the bundle, then strip the tag from
    // the displayed msg (the node already groups by bundle, so the prefix would just be noise).
    var bm=raw.match(/^\s*\[([a-z0-9-]+)\]\s*/);
    var bundle=bm?bm[1]:null;
    var msg=bm?raw.slice(bm[0].length):raw;
    var a=anchoredStage(raw);
    // GLOBAL stage — monotonic max over ALL anchored lines; drives latestStage (overall pipeline progress).
    if(a && (!state.detailStageNow || stageIdx(a)>=stageIdx(state.detailStageNow))) state.detailStageNow=a;
    // PER-BUNDLE stage — bundles run IN PARALLEL, so their "[id] stage:…" lines interleave; a single global
    // stage would mis-bucket a slower bundle's later critique line under expert. Track each bundle's OWN
    // stage so per-node detail (realNodeBodyHtml filters by stage+bundle) shows each bundle's real events.
    if(!state.detailStageByBundle) state.detailStageByBundle={};
    if(a && bundle){ var cb=state.detailStageByBundle[bundle]; if(!cb || stageIdx(a)>=stageIdx(cb)) state.detailStageByBundle[bundle]=a; }
    // Checkpoint replay markers (resume): an untagged "stage:<key> · ⟳ reused …" line marks that STAGE as
    // cached; a bundle-tagged one marks that LANE as cached. Drives the dashed-green node styling.
    // A reused LANE logs "⟳ lane reused from …" and a delta lane "⟳ lane revived from …" — neither
    // contains "⟳ reused", so the lane cards never got the reused look.
    if(raw.indexOf('⟳ reused')>=0||raw.indexOf('⟳ lane reused')>=0){
      if(!state.detailCached) state.detailCached={stages:{},bundles:{},delta:{}};
      if(bundle) state.detailCached.bundles[bundle]=true;
      else if(a) state.detailCached.stages[a]=true;
    } else if(bundle&&raw.indexOf('⟳ lane revived')>=0){
      if(!state.detailCached) state.detailCached={stages:{},bundles:{},delta:{}};
      if(!state.detailCached.delta) state.detailCached.delta={};
      state.detailCached.delta[bundle]=true;
    }
    var b=parseBundlesLine(raw); if(b) state.detailBundles=b;
    // A bundle-tagged line buckets under THAT bundle's own stage; an untagged shared-node line
    // (comprehend / synthesize / findings / report) buckets under the global stage.
    var stg = bundle ? (state.detailStageByBundle[bundle]||'critique') : (state.detailStageNow||'comprehend');
    return { idx:idx+1, stage:stg, kind:eventKind(raw), msg:msg, bundle:bundle, anchored:!!a, t:t };
  }
  function latestStage(){
    var r=activeRun();
    if(!r) return 'comprehend';
    if(r.status==='complete') return 'report';
    return state.detailStageNow||'comprehend';  // the furthest-along anchored stage seen this run
  }
  function stageCounts(){
    var c={}; for(var k=0;k<RUN_STAGES.length;k++) c[RUN_STAGES[k].key]=0;
    for(var i=0;i<state.detailEvents.length;i++) c[state.detailEvents[i].stage]=(c[state.detailEvents[i].stage]||0)+1;
    return c;
  }
  function stageMeta(key,run,counts){
    var n=counts[key]||0;
    if(n) return n+' events';
    if(run && run.status==='complete') return 'complete';
    return 'waiting';
  }
  // % of the pipeline COMPLETED (stages already behind the current one), not "current stage / total" — the old
  // (idx+1)/N said "13% done" the moment stage 1 of 8 started. A failed/stopped run has no meaningful % (the old
  // fixed 58% was invented): null ⇒ the topbar shows the status word instead.
  function progressForRun(r){
    if(r.status==='complete') return 100;
    if(r.status==='error'||r.status==='stopped') return null;
    if(r.id===state.activeRunId && state.detailEvents.length) return Math.min(96, Math.max(1, (stageIdx(latestStage())/RUN_STAGES.length)*100));
    return r.logCount ? Math.min(82, 5 + r.logCount * 2) : 1;
  }
  function progressLabel(r){ var p=progressForRun(r); return p==null?'<span><b>'+esc(r.status==='stopped'?'stopped':'failed')+'</b></span>':'<span><b>'+Math.round(p)+'%</b> done</span>'; }
  function selectedArtifactsForRun(run){
    var out=[];
    state.sources.forEach(function(s){
      var arts=s.artifacts||[];
      if(s.kind==='github'){
        var repos=run.repoFilter||[];
        arts.forEach(function(a){ if(repos.indexOf(a.id)>=0) out.push({kind:'repo',source:s.name,label:a.label,sub:a.sub||'repo',stages:['comprehend','critique','expert','findings'],detail:'Selected repository; cloned read-only and used as evidence for comprehend, critique, expert verdicts, and findings.'}); });
      } else if(run.mode==='agentic' && (s.kind==='warehouse'||s.kind==='keyvalue')){
        var sub=s.kind==='keyvalue'?'key-value MCP':'warehouse';
        out.push({kind:'context',source:s.name,label:s.name,sub:sub,stages:['critique','expert'],detail:s.detail||'Agentic enrichment source mounted read-only during critique + expert measurement.'});
      }
    });
    if(!out.length && run.targetName) out.push({kind:'repo',source:'target',label:run.targetName,sub:'historical run',stages:['comprehend','critique','expert','findings'],detail:'This run predates detailed artifact metadata in the console state.'});
    return out;
  }
  // The filter a mode's history strip shows (All / Running / Completed / Failed); keeps the chips' active state in step.
  function historyFilter(mode){
    var M={run:['runFilter','data-run-filter'],ask:['askRunFilter','data-ask-filter']}[mode];
    var f=state[M[0]]||'all';
    var chips=document.querySelectorAll('['+M[1]+']');
    for(var i=0;i<chips.length;i++){ chips[i].className='run-filter'+(chips[i].getAttribute(M[1])===f?' active':''); }
    return f;
  }
  function renderRunList(){
    var host=document.getElementById('runHistoryList'); if(!host) return;
    var _hf=historyFilter('run');
    var q=state.runQuery.toLowerCase();
    var visible=state.runs.filter(function(r){
      if(r.kind==='ask') return false;   // Quick Ask runs live in the Quick Ask tab's own history — Full Scan lists only scans
      if(_hf!=='all' && r.status!==_hf) return false;
      var hay=[r.id,r.alias||'',r.mode,r.targetName,r.status,r.brief||'',(r.repoFilter||[]).join(' '),(r.projectFilter||[]).join(' ')].join(' ').toLowerCase();
      return !q || hay.indexOf(q)>=0;
    });
    var count=document.getElementById('runHistoryCount'); if(count) count.textContent=String(visible.length);
    // Deck: a dashed honey "New full scan" tile leads the history strip. It opens the config form through the
    // shared 'newrun' dispatcher (same entry as the topbar + New button). Always present, even when empty.
    var newTile='<button class="run-card run-card-new" data-act="newrun" title="Start a new full scan"><span class="rcn-plus">+</span><span class="rcn-lbl">New full scan</span></button>';
    host.innerHTML=newTile+(visible.length?visible.map(function(r){
      // Inline TITLE editor. This edits the run TITLE (r.renamed override), NOT the alias (which
      // relabels the id in the run detail). While editing, render the card as a <div> (not <button>) so the
      // <input> receives focus/typing cleanly. Distinct data-act names (title-*) so they never clash with the
      // alias 'rename-run'. esc() every dynamic value; no literal backticks (String.raw template).
      var editing=(state.editingTitleRunId===r.id);
      var titleCell = editing
        ? '<span class="run-card-title lead run-title-row" style="display:flex;align-items:center;gap:6px">'
            +'<input class="run-title-input" data-act="title-input" data-id="'+esc(r.id)+'" value="'+esc(runTitle(r))+'" placeholder="Run title" spellcheck="false" autocomplete="off" style="flex:1;min-width:0;font:inherit;padding:2px 6px;border:1px solid var(--line);border-radius:6px;background:var(--cream-card);color:var(--espresso)">'
            +'<span class="run-title-act" data-act="title-save" data-id="'+esc(r.id)+'" role="button" tabindex="0" title="Save" style="cursor:pointer;padding:0 5px">✓</span>'
            +'<span class="run-title-act" data-act="title-cancel" data-id="'+esc(r.id)+'" role="button" tabindex="0" title="Cancel" style="cursor:pointer;padding:0 5px;color:var(--muted)">✕</span>'
          +'</span>'
        : '<span class="run-card-title lead" title="'+esc(libKindOf(r)==='scan'?runTitleBare(r):runTitle(r))+'">'+esc(libKindOf(r)==='scan'?runTitleBare(r):runTitle(r))   // UI-6: a Full Scan card in the Full Scan tab drops the redundant prefix; audit / legacy cards keep their kind
            +'<button type="button" class="run-title-pencil" data-act="title-edit" data-id="'+esc(r.id)+'" aria-label="Rename" title="Edit title" style="margin-left:7px;color:var(--muted);font-size:12px">✎</button>'
          +'</span>';
      var inner=titleCell   // polish: the run TITLE leads; the id is secondary (muted, after the status)
        +'<span class="run-card-top">'+statusBadge(r.status)
        +(r.resumedFrom?' <span class="sbadge cache">↻ resumed</span>':'')
        +(r.supersededBy?' <span class="sbadge info" title="Replaced by a resumed child run — open it for the newer results">superseded</span>':'')
        +(r.alias?'<span class="run-card-id">'+esc(r.alias)+'</span>':'')+'</span>'
        +(r.createdAt?'<span class="run-card-when">'+esc(relTime(r.createdAt))+'</span>':'');
      if(editing) return '<div class="run-card '+(r.id===state.activeRunId?'active':'')+'">'+inner+'</div>';
      return '<div class="run-card '+(r.id===state.activeRunId?'active':'')+'" data-run="'+esc(r.id)+'" role="button" tabindex="0">'+inner+'</div>';   // A div (Space/Enter via the role=button key handler) so the ✎ Rename <button> is not nested inside a <button>
    }).join(''):((q||_hf!=='all'||state.runs.some(function(r){return r.kind!=='ask';}))?'<div class="run-empty">No matching runs.</div>':''));   // an EMPTY history shows just the New tile ("No matching runs" only makes sense when a search / filter hid some)
    // Focus + select the freshly-mounted title input so the user can type immediately.
    if(state.editingTitleRunId){ var ti=host.querySelector('.run-title-input'); if(ti){ ti.focus(); try{ti.select();}catch(e){} } }
  }
  // ---------- Quick Ask run history (mirror of the Full Scan strip, ask runs only) ----------
  // The ask ENTRY stays Compose Question — no "+ new" tile here; the strip is history only.
  function renderAskRunList(){
    var host=document.getElementById('askHistoryList'); if(!host) return;
    var _hf=historyFilter('ask');
    var q=(state.askRunQuery||'').toLowerCase();
    var visible=state.runs.filter(function(r){
      if(r.kind!=='ask') return false;
      if(_hf!=='all' && r.status!==_hf) return false;
      var hay=[r.id,r.alias||'',r.targetName||'',r.askQuestion||'',r.askScope||'',r.status].join(' ').toLowerCase();
      return !q || hay.indexOf(q)>=0;
    });
    // Deck: a dashed honey "New Quick Ask" tile leads the ask strip (mirrors Full Scan's "New full scan" tile).
    // Closes any open past-ask detail and returns to the compose form. Always present, even when empty.
    var newTile='<button class="run-card run-card-new" data-act="new-ask" title="Compose a new Quick Ask"><span class="rcn-plus">+</span><span class="rcn-lbl">New Quick Ask</span></button>';
    host.innerHTML=newTile+(visible.length?visible.map(function(r){
      var inner='<span class="run-card-title lead" title="'+esc(runTitleBare(r))+'">'+esc(runTitleBare(r))+'</span>'   // UI-6: inside the Quick Ask tab, no "Quick Ask · " prefix; polish: the title leads
        +'<span class="run-card-top">'+statusBadge(r.status)+(r.alias?'<span class="run-card-id">'+esc(r.alias)+'</span>':'')+'</span>'
        +(r.createdAt?'<span class="run-card-when">'+esc(relTime(r.createdAt))+'</span>':'');
      return '<button class="run-card '+(r.id===state.askDetailId?'active':'')+'" data-ask-run="'+esc(r.id)+'">'+inner+'</button>';
    }).join(''):((q||_hf!=='all')?'':'<span class="ask-empty-hint">No Quick Asks yet — <b>+ New Quick Ask</b> asks one scoped question about your connected code or data: read-only, minutes, one answer report.</span>'));
  }
  // Past-ask detail under the strip: the FULL run-result view (askDetailHtml — header + intake + Pipeline +
  // Run log + Memory / Run output), exactly like /run?run=<ask>. While a past ask is open the Compose form +
  // its pipeline/log grid hide (result view OR compose entry, never both); ✕ closes back to Compose.
  // Quick Ask's own plane picker: a separate, NON-persisted selection (a fresh compose starts unticked).
  function renderAskPlanes(){
    var host=document.getElementById('askPlaneBox'); if(!host) return;
    host.innerHTML='<span class="eyebrow cfg-lab">Data sources</span>'+planePickerHtml(planeChoices(state.sources,ASK_PLANE_KINDS),state.askPlaneSel,'ask');
    paintAskScopeLine();
  }
  function paintAskScopeLine(){
    var line=document.getElementById('askScopeLine'), f=askPlaneFilters();
    var rc=document.getElementById('askUseMemory'), wm=document.getElementById('askWriteMemory');
    if(line) line.textContent=askScopeSummary(selectedAskRepos().length,f.planeFilter.length,selectedAskLocal().length,{ recall:!!(rc&&rc.checked), save:!!(wm&&wm.checked) });
    var h=document.getElementById('askSaveHint'); if(h) h.hidden=!(wm&&wm.checked);
  }
  function askPlaneFilters(){
    var pc=planeChoices(state.sources,ASK_PLANE_KINDS);
    return { planeFilter:pc.planes.filter(function(p){ return state.askPlaneSel[p.id]===true; }).map(function(p){ return p.id; }) };
  }
  function renderAskRunDetail(){
    if(currentView()==='ask') renderTopbar('ask');   // The strip follows the open ask (or hides while composing)
    var host=document.getElementById('askRunDetail'); if(!host) return;
    var compose=document.getElementById('askComposeWrap');
    var r=state.askDetailId?runById(state.askDetailId):null;
    // Master-detail, 3 states: (1) a selected ask → run detail; (2) composing (New) → show the
    // compose form; (3) DEFAULT → empty pane (compose hidden). No auto-shown blank form on nav-in.
    if(!r||r.kind!=='ask'){ host.innerHTML=''; if(compose) compose.style.display=state.askComposing?'':'none'; if(state.askComposing) renderAskPlanes(); return; }
    if(compose) compose.style.display='none';
    // No close row here: the "+ New Quick Ask" tile in the history strip returns to the compose form (deck).
    // Preserve the log scroll across live re-renders (tail if the user was near the bottom) — same
    // pattern as the /run host, on this host's OWN element id.
    var old=document.getElementById('askEventStream'); var prevTop=old?old.scrollTop:0; var prevNear=old?(old.scrollHeight-old.scrollTop-old.clientHeight<60):true;
    host.innerHTML=askDetailHtml(r,'askEventStream');
    var box=document.getElementById('askEventStream'); if(box) box.scrollTop=prevNear?box.scrollHeight:prevTop;
  }
  function metricCell(v,l,ink){ return '<div class="rd-metric"><div class="v'+(ink?' txt':'')+'">'+esc(String(v))+'</div><div class="l">'+esc(l)+'</div></div>'; }
  // Resume-pane "what will run" PREVIEW override: when set, node/lane statuses come from the plan
  // (cached vs queued) instead of the parsed run state. Set around ONE timelineHtml call, then cleared.
  var previewPlan=null;
  // Status of a single graph node given the run + the index of the currently-running stage.
  // 'done' (stage passed / run complete), 'running' (the live stage), 'failed', 'cached'
  // (passed via a checkpoint replay — the ⟳ reused markers), or 'queued'.
  function nodeStatus(stageKey,run,curIdx){
    if(previewPlan) return previewPlan.node(stageKey);
    var i=stageIdx(stageKey);
    var cached=state.detailCached&&state.detailCached.stages[stageKey];
    if(run.status==='complete'||i<curIdx) return cached?'cached':'done';
    if(run.status==='error'&&i===curIdx) return 'failed';
    if(i===curIdx&&run.status==='running') return cached?'cached':'running';
    return 'queued';
  }
  // Per-bundle node status — bundles run IN PARALLEL, so a Critic/Expert lane reflects ITS OWN bundle's
  // stage (state.detailStageByBundle[bundle]), NOT the global curIdx. Without this, the fastest bundle
  // entering expert marked EVERY bundle's Critic node done (even ones still posing). complete ⇒ all done.
  function laneNodeStatus(stageKey,bundle,run){
    if(previewPlan) return previewPlan.lane(bundle);
    var cached=state.detailCached&&state.detailCached.bundles[bundle];   // this LANE was replayed from a checkpoint
    if(run.status==='complete') return cached?'cached':'done';
    // Once the GLOBAL pipeline reaches synthesize (the fan-in barrier, emitted UNTAGGED after Promise.all),
    // every bundle's critique+expert is definitionally done. NOT '> expert': mitigate (idx 3 > expert) is
    // emitted per-bundle-TAGGED, so the fastest bundle entering mitigate would otherwise mark slower
    // bundles' lanes done while they're still posing — a bug class fixed before.
    if(state.detailStageNow && stageIdx(state.detailStageNow) >= stageIdx('synthesize')) return cached?'cached':'done';
    var bs=(state.detailStageByBundle&&state.detailStageByBundle[bundle])||null;
    if(!bs) return 'queued';                       // this bundle hasn't started yet
    var i=stageIdx(stageKey), bi=stageIdx(bs);
    if(i<bi) return cached?'cached':'done';         // this bundle already passed this stage
    if(run.status==='error'&&i===bi) return 'failed';
    if(i===bi) return cached?'cached':'running';    // this bundle is on this stage right now (a cached lane replays instantly)
    return 'queued';
  }
  function gChips(stageKey,extra){
    var s=RUN_STAGES[stageIdx(stageKey)]||{}; var sub=(s.sub||[]).slice();
    if(extra) sub.push(extra);
    return sub.length?'<div class="g-chips">'+sub.map(function(c){return '<span class="g-chip">'+esc(c)+'</span>';}).join('')+'</div>':'';
  }
  // Which bundles fan out for this run — Comprehend's REAL decision. Sample: the fixture's set. Real run:
  // the bundles parsed from the comprehend marker; EMPTY until Comprehend has decided, so the Critic/Expert
  // lanes appear dynamically (not all-at-once from the start).
  // The lanes are the UNION of Comprehend's announced set, the bundle-frontier/barrier checkpoints' completed
  // bundles and the produced area reports (laneBundleIds) — a derived lane never named in the Comprehend line used to
  // vanish from the graph. An id the console has no label for renders under its area-report title (or the id).
  function activeBundles(run){
    run=run||activeRun()||{};
    var ids=laneBundleIds(state.detailBundles, (run.id?ckListOf(run):[]), run.bundleReports);
    return ids.map(function(id){
      for(var i=0;i<BUNDLES.length;i++) if(BUNDLES[i].key===id) return BUNDLES[i];
      var br=(run.bundleReports||[]).filter(function(b){ return b&&b.id===id; })[0];
      return { key:id, label:(br&&br.title)||id };
    });
  }
  // Has Comprehend finished classifying? (bundles are known — announced, or evidenced by a checkpoint / area report.)
  function bundlesDecided(run){
    return activeBundles(run).length>0;
  }
  function isSelected(nodeKey,bundleKey){ return state.selNode===nodeKey && (state.selBundle||null)===(bundleKey||null); }
  // One graph node card (used for the single root + the three converge nodes). Clickable:
  // data-node selects it for the side detail panel.
  function gNode(stageKey,run,counts,curIdx,opts){
    opts=opts||{}; var s=RUN_STAGES[stageIdx(stageKey)]||{key:stageKey,label:stageKey};
    var st=nodeStatus(stageKey,run,curIdx); var sel=isSelected(stageKey,null);
    var icon=st==='done'?'✓':st==='failed'?'!':st==='running'?'▶':st==='cached'?'⟳':'';
    return '<div class="g-node '+st+(sel?' selected':'')+(opts.cls?' '+opts.cls:'')+'" data-node="'+esc(stageKey)+'" data-run-stage="'+esc(stageKey)+'" role="button" tabindex="0">'
      +(opts.ckpt?'<span class="g-ckpt" title="durable checkpoint saved — a resume can start here">◆</span>':'')
      +'<div class="g-node-head"><span class="g-dot '+st+'">'+icon+'</span><span class="g-name">'+esc(s.label)+'</span>'+(s.kind?'<span class="g-kind">'+esc(s.kind)+'</span>':'')+'<span class="g-meta">'+esc(stageMeta(stageKey,run,counts))+'</span></div>'
      +'<div class="g-desc">'+esc(STAGE_DESC[stageKey]||'')+'</div>'+gChips(stageKey,opts.extraChip)+'</div>';
  }
  // Compact per-lane node: a bundle's Critic OR Expert half. Clickable per (stage,bundle).
  // Lights for that stage across all lanes for now. // TODO per-bundle marker — light only
  // the lane the backend reports as active.
  function gLaneNode(stageKey,bundleKey,role,run,curIdx,extraChip){
    var st=laneNodeStatus(stageKey,bundleKey,run); var sel=isSelected(stageKey,bundleKey);
    var icon=st==='done'?'✓':st==='failed'?'!':st==='running'?'▶':st==='cached'?'⟳':'';
    var s=RUN_STAGES[stageIdx(stageKey)]||{};
    var chips=(s.sub||[]).slice(); if(extraChip) chips.push(extraChip);
    return '<div class="g-lnode '+st+(sel?' selected':'')+'" data-node="'+esc(stageKey)+'" data-bundle="'+esc(bundleKey)+'" data-run-stage="'+esc(stageKey)+'" role="button" tabindex="0">'
      +'<div class="g-lnode-head"><span class="g-dot sm '+st+'">'+icon+'</span><span class="g-lrole">'+esc(role)+'</span>'+(s.kind?'<span class="g-lkind">'+esc(s.kind)+'</span>':'')+'</div>'
      +'<div class="g-lchips">'+chips.map(function(c){return '<span class="g-chip">'+esc(c)+'</span>';}).join('')+'</div></div>';
  }
  // SVG fan band: dir 'out' splays one top anchor to N bottom anchors; 'in' merges N->1.
  // preserveAspectRatio none lets it stretch to the lane grid width responsively.
  function fanSvg(n,dir){
    var W=1000,H=42,paths=''; var topY=dir==='out'?2:H-2, botY=dir==='out'?H-2:2;
    for(var k=0;k<n;k++){ var x=n===1?W/2:(W/(n+1))*(k+1); var mid=(topY+botY)/2;
      paths+='<path d="M'+(W/2)+' '+topY+' C '+(W/2)+' '+mid+', '+x+' '+mid+', '+x+' '+botY+'" />'; }
    return '<svg class="g-fan" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+paths+'</svg>';
  }
  // The dynamic branching graph: Comprehend (root) → fan-out → per-bundle Critic → Preflight →
  // Expert lanes → fan-in → Synthesis → Findings → Reports (Analyst ⇄ QC). Lanes GENERATED from BUNDLES.
  function timelineHtml(run,counts,curIdx){
    if(isDeterministicRun(run)){   // The deterministic pipeline is two nodes, not the agentic 8-stage graph
      var dp=detPipeline(run);
      return '<div class="graph">'+dp.steps.map(function(x,i){
        var ico=x.st==='done'?'✓':x.st==='failed'?'!':x.st==='running'?'▶':'';
        return (i?'<div class="g-vlink"></div>':'')+'<div class="g-tnode '+x.st+'"><span class="g-dot '+x.st+'">'+ico+'</span>'
          +'<div class="g-tbody"><div class="g-ttitle">'+esc(x.title)+'</div><div class="g-tsub">'+esc(x.sub)+'</div></div></div>';
      }).join('')+'</div>';
    }
    var bundles=activeBundles(run); var n=bundles.length;
    var decided=bundlesDecided(run);
    // ◆ checkpoint anchors: which graph nodes have a durable cut saved (run.checkpoints meta rows) —
    // stage cards by checkpoint id, lanes by the frontier/barrier's completed-bundle set.
    var ckIds={}; var ckLanes={};
    ckListOf(run).forEach(function(c){ ckIds[c.id]=true; if((c.id==='frontier'||c.id==='barrier')&&c.bundlesDone) c.bundlesDone.forEach(function(id){ckLanes[id]=true;}); });
    function ckMark(has,title){ return has?'<span class="g-ckpt" title="'+esc(title||'durable checkpoint saved — a resume can start here')+'">◆</span>':''; }
    var isPrev=(run&&run.status==='config');   // config preview: show ALL candidate bundles (5), not just activated
    if(isPrev){ bundles=BUNDLES.slice(); n=bundles.length; decided=true; ckIds={}; ckLanes={}; }
    // The config preview is a blank TEMPLATE: no state from a run viewed earlier (its events, reuse / Change tags,
    // node statuses, findings count) may leak in — every node reads 'queued', no counts.
    function nodeSt(k){ return isPrev?'queued':nodeStatus(k,run,curIdx); }
    function laneSt(k,b){ return isPrev?'queued':laneNodeStatus(k,b,run); }
    function isSel(k,b){ return !isPrev&&isSelected(k,b); }
    function icoFor(st){ return st==='done'?'✓':st==='failed'?'!':st==='running'?'▶':st==='cached'?'⟳':''; }
    function laneEvents(key){ if(isPrev) return 0; var c=0; for(var i=0;i<state.detailEvents.length;i++){ if(state.detailEvents[i].bundle===key) c++; } return c; }
    function step(stageKey,label,key){
      var st=laneSt(stageKey,key); var sel=isSel(stageKey,key);
      return '<span class="g-step '+st+(sel?' selected':'')+'" data-node="'+esc(stageKey)+'" data-bundle="'+esc(key)+'" data-run-stage="'+esc(stageKey)+'" role="button" tabindex="0">'+esc(label)+'</span>';
    }
    var cSt=nodeSt('comprehend'); var cSel=isSel('comprehend',null);
    var cType=run.companyType||run.classification||'';
    var rootSub=isPrev
      ? 'classifies the system, then activates the bundles that fit — all '+n+' candidates are drawn below'   // No fake "activated N bundles" in the static preview
      : cSt==='cached'
      ? '⟳ classification reused from the parent run · $0'
      : decided
        ? 'classified '+(cType?esc(cType)+' · ':'')+'activated '+n+' bundle'+(n===1?'':'s')
        : 'classifying the system — bundles activate when Comprehend finishes';
    var root='<div class="g-tnode '+cSt+(cSel?' selected':'')+'" data-node="comprehend" data-run-stage="comprehend" role="button" tabindex="0">'
      +ckMark(ckIds['comprehend'])
      +'<span class="g-dot '+cSt+'">'+icoFor(cSt)+'</span>'
      +'<div class="g-tbody"><div class="g-ttitle">Comprehend</div><div class="g-tsub">'+rootSub+'</div></div>'
      +'<span class="g-tag">root</span></div>';
    var lanesBlock;
    if(decided&&n){
      var laneObjs=bundles.map(function(b){
        var laneActive=(laneSt('critique',b.key)==='running'||laneSt('preflight',b.key)==='running'||laneSt('expert',b.key)==='running');
        // A lane replayed from a checkpoint (⟳ reused markers) renders cached: dashed green + a reuse tag,
        // also from the run's incremental summary (reused / delta / re-ran / new), and a delta lane gets its own look.
        var dc=state.detailCached||{};
        var rk=isPrev?'':laneReuseKind(run.incremental,b.key,{ cached:laneSt('expert',b.key)==='cached', delta:!!(dc.delta&&dc.delta[b.key]) });
        var laneCached=rk==='reused', rtag=laneReuseTag(rk,run.incremental,b.key);
        var html='<div class="g-lane2'+(laneActive?' active':'')+(laneCached?' cached':'')+(rk==='delta'?' delta':'')+'" data-node="critique" data-bundle="'+esc(b.key)+'" data-run-stage="critique" data-reuse="'+esc(rk)+'" role="button" tabindex="0">'
          +ckMark(ckLanes[b.key],'durable checkpoint — this lane’s output is on the frontier')
          +'<div class="g-lane2-hd"><span class="g-sq sm"></span><span class="g-lane2-nm">'+esc(b.label)+'</span>'+(rtag?'<span class="g-lane-tag '+esc(rtag.cls)+'" title="'+esc(rtag.title)+'">'+(rtag.bold&&rtag.text.indexOf(rtag.bold)===0?'<b>'+esc(rtag.bold)+'</b>'+esc(rtag.text.slice(rtag.bold.length)):esc(rtag.text))+'</span>':'')+(isPrev?'':'<span class="g-lane2-ct" title="Log events this bundle lane has emitted so far">'+esc(plural(laneEvents(b.key),'event'))+'</span>')+'</div>'   // UI-11: "55 events", not "55 ev"
          +'<div class="g-lane2-steps">'+step('critique','Critic',b.key)+'<span class="g-arrow">→</span>'+step('preflight','Preflight',b.key)+'<span class="g-arrow">→</span>'+step('expert','Expert',b.key)+'</div>'
          +'<div class="g-lane2-sub">Critic poses falsifiable problems · Preflight plans the decisive measurements · Expert measures and resolves each one</div>'
        +'</div>';
        return { html:html, active:laneActive, sel:(state.selBundle===b.key) };
      });
      // With many bundles the fan-out dominates the page: collapsed, show the FIRST 2 + an
      // expandable "⋯ N more" row + the LAST lane. A running or selected lane is never hidden.
      var lanes;
      if(n>4&&!state.graphLanesOpen&&!isPrev){
        var keep={}; keep[0]=true; keep[1]=true; keep[n-1]=true;
        laneObjs.forEach(function(o,li){ if(o.active||o.sel) keep[li]=true; });
        var hiddenN=0; for(var ki=0;ki<n;ki++) if(!keep[ki]) hiddenN++;
        var parts=[]; var moreDone=false;
        for(var li2=0;li2<n;li2++){
          if(keep[li2]) parts.push(laneObjs[li2].html);
          else if(!moreDone){ parts.push('<div class="g-lane2 g-lane-more" data-act="graph-lanes-toggle" role="button" tabindex="0">⋯ <b>'+hiddenN+'</b> more bundle'+(hiddenN===1?'':'s')+' — click to expand</div>'); moreDone=true; }
        }
        lanes=parts.join('');
      } else {
        lanes=laneObjs.map(function(o){return o.html;}).join('')
          +(n>4&&state.graphLanesOpen?'<div class="g-lane2 g-lane-more" data-act="graph-lanes-toggle" role="button" tabindex="0">Collapse bundles ↑</div>':'');
      }
      lanesBlock='<div class="g-flabel">'+(isPrev?'Fan-out · one lane per activated bundle · parallel (candidates shown)':'Fan-out · '+n+' bundle'+(n===1?'':'s')+' · parallel')+'</div>'
        +'<div class="g-rail">'+lanes+'</div>'
        +'<div class="g-flabel">Fan-in</div>';
    } else {
      lanesBlock='<div class="g-lanes-pending">'+(decided?'No expert bundles activated.':'⏳ Bundle lanes appear once Comprehend classifies the system…')+'</div>';
    }
    var sSt=nodeSt('findings'); var sSel=isSel('synthesize',null); var fSel=isSel('findings',null);
    var nAreas=(run.status==='complete') ? (run.bundleReports||[]).length : n;
    var findings=run.findings||0;
    var synth='<div class="g-tnode '+sSt+(sSel?' selected':'')+'" data-node="synthesize" data-run-stage="synthesize" role="button" tabindex="0">'
      +ckMark(ckIds['synthesis']||ckIds['findings'])
      +'<span class="g-dot '+sSt+'">'+icoFor(sSt)+'</span>'
      +'<div class="g-tbody"><div class="g-ttitle">Synthesis · Findings</div>'
      +'<div class="g-tsub">'+(sSt==='cached'?'⟳ reused from the parent run · $0 · ':'grouped by theme · ')
      +(isPrev?'<span class="g-inchip">findings</span>':'<span class="g-inchip'+(fSel?' selected':'')+'" data-node="findings" data-run-stage="findings" role="button" tabindex="0">'+findings+' finding'+(findings===1?'':'s')+'</span>')+'</div></div></div>';
    var rSt=nodeSt('report'); var rSel=isSel('report',null);
    var areaCount=(run.status==='complete') ? (run.bundleReports||[]).length : n;
    var reports='<div class="g-tnode '+rSt+(rSel?' selected':'')+'" data-node="report" data-run-stage="report" role="button" tabindex="0">'
      +ckMark(ckIds['reports']||ckIds['reconciled']||ckIds['combined'])
      +'<span class="g-sq">'+(rSt==='cached'?'⟳':'⇄')+'</span>'
      +'<div class="g-tbody"><div class="g-ttitle">Reports</div>'
      +'<div class="g-tsub">'+(rSt==='cached'?'⟳ carried forward from the parent run · ':'')+'leadership + execution</div></div></div>';
    // Deck: a terminal "Combined report" node — the Normalizer's reconcile→merge output. Shown when the run
    // produces (or, in-flight/preview, will produce) a combined deliverable: complete ⇒ gate on run.combined;
    // otherwise any agentic run whose bundles are decided. Binds to the report stage like the reports node.
    var showCombined=false;   // two-report model: no Combined report
    var cbSel=isSel('report',null);
    var combined=showCombined
      ? '<div class="g-vlink"></div>'
        +'<div class="g-combined'+(rSt==='cached'?' cached':'')+(cbSel?' selected':'')+'" data-node="report" data-run-stage="report" role="button" tabindex="0">'
        +'<span class="g-combined-nm">Combined report</span>'
        +'<span class="g-combined-tag">reconcile → normalize</span></div>'
      : '';
    return '<div class="graph">'+root
      +'<div class="g-vlink"></div>'
      +lanesBlock
      +'<div class="g-vlink"></div>'
      +synth
      +'<div class="g-vlink"></div>'
      +reports
      +combined
    +'</div>';
  }
  // ---------- node detail panel ----------
  function dispoCls(d){ if(d==='confirmed') return 'dispo-bad'; if(/refuted/.test(d||'')) return 'dispo-good'; return 'dispo-eval'; }
  // Modal title for the selected node, e.g. "Critic · Data Eng".
  function nodeModalTitle(){
    if(!state.selNode) return 'Node detail';
    var titleBundle=state.selBundle?BUNDLES.filter(function(b){return b.key===state.selBundle;}).map(function(b){return b.label;})[0]||state.selBundle:'';
    var s=RUN_STAGES[stageIdx(state.selNode)]||{label:state.selNode};
    var roleName=state.selNode==='critique'?'Critic':state.selNode==='preflight'?'Preflight':state.selNode==='expert'?'Expert':s.label;
    return roleName+(titleBundle?' · '+titleBundle:'');
  }
  // Inner detail content for the selected node (no chrome — the modal supplies header/close).
  // REAL run: the per-node detail is the live event stream filtered to this stage (the backend emits
  // log lines, not structured node JSON — each line is bucketed under the current anchored stage by
  // parseRunEvent). Honest + useful: each node shows exactly what its agents reported, in order, with a kind badge.
  function realNodeBodyHtml(run,nodeKey){
    // When a bundle lane is selected (Critic/Expert of a specific bundle), show ONLY that bundle's events
    // (plus any un-tagged event for the stage); otherwise show the whole stage. This is what makes the
    // per-bundle nodes show each bundle's OWN critic problems / expert verdicts instead of a merged blob.
    // Event scoping. For a bundle-scoped node: show that bundle's own tagged events. A LANE stage (critique/preflight/
    // expert) also folds in the stage's UNtagged shared lines (rare); but the REPORT stage's untagged lines are the
    // GLOBAL leadership/internal/free-vibe writers — those must NOT bleed into a single bundle's area-report card, so a
    // bundle-scoped report node shows ONLY that bundle's tagged events. No bundle selected → whole stage.
    var evs=state.detailEvents.filter(function(e){
      if(e.stage!==nodeKey) return false;
      if(!state.selBundle) return true;                                  // node selected with no bundle → all stage events
      if(e.bundle===state.selBundle) return true;                        // this bundle's own tagged events
      return e.bundle ? false : nodeKey!=='report';                      // untagged: fold into lane stages, NOT report
    });
    var head='<div class="np-count">'+evs.length+' event'+(evs.length===1?'':'s')+' · '+esc(stageLabel(nodeKey))+'</div>';
    var body=evs.length
      ? evs.map(function(e){var kc=e.kind==='error'?'dispo-bad':(e.kind==='verify'?'dispo-good':'dispo-eval');
          return '<div class="np-item"><div class="np-item-h"><span class="np-idx">#'+e.idx+'</span><span class="np-dispo '+kc+'">'+esc(e.kind)+'</span></div><div class="np-ev">'+esc(e.msg)+'</div></div>';}).join('')
      : '<div class="np-note">'+(run.status==='running'?'This stage hasn’t emitted events yet — tailing the live run…':'No events were recorded for this stage.')+'</div>';
    var rep='';
    if(nodeKey==='report'&&run.status==='complete'){
      rep='<div class="np-acts" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'
        +(run.leadership?'<button class="btn ghost openlead" data-id="'+esc(run.id)+'">Open leadership report →</button>':'')
        +'<button class="btn ghost" data-rk="internal" data-id="'+esc(run.id)+'">Open '+esc(internalReportLabel(run).toLowerCase())+' →</button>'
        +'</div>';
    }
    return head+body+rep;
  }
  function nodeModalBodyHtml(run){
    if(!state.selNode || !run) return '';
    return realNodeBodyHtml(run,state.selNode);
  }
  // ---------- node detail POP-UP modal ----------
  // The modal is a persistent top-level element (sibling of #overlay) so it floats above the
  // sticky topbar and survives the run-detail card re-render that fires every reveal tick.
  // The modal is a PASSIVE reader: it (re)builds ONLY when the selection changes (open / switch node /
  // close), keyed by a signature. So a background re-render — a throttle tick or an SSE event — never
  // rebuilds it under the user (no flashing, no scroll reset). It opens on an explicit click, full stop.
  function renderNodeModal(){
    var m=document.getElementById('nodeModal'); if(!m) return;
    var run=activeRun();
    var open=state.modalOpen && !state.configOpen && currentView()==='run' && !!state.selNode && !!run;
    var sig=open ? (run.id+'|'+state.selNode+'|'+(state.selBundle||'')+'|'+(run.status||'')) : 'closed';
    if(m.dataset.sig===sig) return;        // selection unchanged → leave the DOM + the user's scroll alone
    m.dataset.sig=sig;
    if(!open){ m.hidden=true; m.innerHTML=''; return; }
    m.hidden=false;
    m.innerHTML='<div class="nm-card" role="dialog" aria-modal="true" aria-label="'+esc(nodeModalTitle())+'">'
      +'<div class="nm-head"><div style="min-width:0"><div class="nm-kicker">'+esc('node detail')+'</div><div class="nm-title">'+esc(nodeModalTitle())+'</div><div class="nm-sub">'+esc(STAGE_DESC[state.selNode]||'')+'</div></div>'
      +'<button class="nm-x" data-act="close-modal" aria-label="Close">×</button></div>'
      +'<div class="nm-body">'+nodeModalBodyHtml(run)+'</div></div>';
  }
  // Open on an explicit click — pins the selection; the modal then shows that node's detail, stable.
  function openNodeModal(node,bundle){
    state.selNode=node; state.selBundle=bundle||null; state.detailStage=node; state.stagePinned=true; state.modalOpen=true;
    renderRunList(); renderRunDetail(); renderNodeModal();
  }
  function closeNodeModal(){ state.modalOpen=false; renderRunDetail(); renderNodeModal(); }
  // Poll /api/state until a QUEUED run this detail is watching gets promoted to 'running' (then re-attach its live
  // stream) or reaches a terminal state (then stop). Guards against duplicate timers + navigating away.
  function waitForPromotion(id){ if(state._qPoll) clearTimeout(state._qPoll);
    state._qPoll=setTimeout(function(){ state._qPoll=null; if(state.activeRunId!==id) return;
      loadState().then(function(){ if(state.activeRunId!==id) return; var rr=runById(id); if(!rr) return;
        if(rr.status==='running'){ state.detailLoadedId=null; attachDetailStream(id); }
        else if(rr.status==='queued'){ waitForPromotion(id); }
      }).catch(function(){ waitForPromotion(id); });
    }, 3000);
  }
  function renderRunConfig(host){
    ensureArtDefaults();
    var srcs=state.sources.filter(function(s){ return (s.artifacts||[]).length; });
    var keys=allArtifactKeys(); var nSel=keys.filter(function(k){return state.artSel[k]!==false;}).length; var allOn=(nSel===keys.length&&keys.length);
    var needTok=needsClaudeToken();
    // Invariant picker: the consolidated data-trust checks, GROUPED BY THE BUNDLE THAT OWNS each. DEFAULT = the
    // Baseline data-trust FLOOR checked (i.floor from the server); the rest opt-in. The baseline lane honors the pick
    // Each row is tagged by its mount policy (default floor / with bundle / gated). Seed invSel once from floor.
    var invs=window.__INV__||[];
    if(!Object.keys(state.invSel).length){ invs.forEach(function(i){ state.invSel[i.key]=!!i.floor; }); }
    var nInvSel=invs.filter(function(i){return state.invSel[i.key]!==false;}).length;
    var allInvOn=(nInvSel===invs.length&&invs.length);
    // Invariant picker removed from the full-scan layout; state.invSel is still seeded from the floor
    // above, so startRun() sends the default data-trust floor (auto invariants) as before.
    // Expert-bundle picker (agentic runs). Comprehend auto-selects the bundles UNLESS you turn on
    // "Override Comprehend": then the checkboxes ENABLE and the run uses EXACTLY the ticked set (baseline iff ticked,
    // Comprehend skipped). Off ⇒ the boxes are greyed/non-interactive and it's pure auto.
    var ov=state.overrideBundles===true;
    var nBunSel=BUNDLES.filter(function(b){return state.bundleSel[b.key]===true;}).length;
    var bunList=BUNDLES.map(function(b){var on=ov&&state.bundleSel[b.key]===true;
      // A real ARIA checkbox (role + aria-checked + tabindex; Space/Enter via the cfgKeyActivate handler)
      return '<div class="cfg-item"'+(ov?' data-bpick="'+esc(b.key)+'" role="checkbox" tabindex="0" aria-checked="'+(on?'true':'false')+'"':'')+' title="'+esc(b.key)+'"><span class="cbx'+(on?' on':'')+'" aria-hidden="true"></span><span class="cfg-lbl"><b>'+esc(b.label)+'</b></span>'+(b.key==='baseline'?'<span class="cfg-sub" style="color:var(--muted)">data-trust floor</span>':'')+'</div>';
    }).join('');
    // Public-URL repos + uploaded folders had no noun ('0 / 3 items'); singular when there is exactly one.
    var openSrcPop='';
    var srcChips=srcs.length?srcs.map(function(s){var arts=s.artifacts||[];var tot=arts.length;var noun=srcChipNoun(s.kind,2);
      var sel=arts.filter(function(a){return state.artSel[s.id+'::'+a.id]!==false;}).length;
      var open=state.openSrc===s.id;
      var rows=arts.map(function(a){var k=s.id+'::'+a.id;var on=state.artSel[k]!==false;
        var sub=(s.kind==='local')?localFolderSub(a):(a.sub||'');   // An uploaded folder shows its upload time + file count
        var hay=((a.label||'')+' '+sub).toLowerCase();
        return '<div class="cfg-srcdd-row" data-art="'+esc(k)+'" data-srcq="'+esc(hay)+'" role="checkbox" tabindex="0" aria-checked="'+(on?'true':'false')+'"><span class="cbx'+(on?' on':'')+'" aria-hidden="true"></span><span class="cfg-srcdd-lbl">'+esc(a.label)+(sub?'<span class="cfg-srcdd-sub">'+esc(sub)+'</span>':'')+'</span></div>';
      }).join('');
      // Search box in the popover so 100+ repos/projects are filterable instead of hand-scrolled. Shown once a source
      // has enough items to warrant it; filters rows in the DOM (filterSrcRows) so typing never re-renders / loses focus.
      var srch=(open&&tot>8)?('<input class="cfg-srcdd-search" data-act="src-search" value="'+esc(state.srcQuery||'')+'" placeholder="Search '+esc(noun)+'… ('+tot+')" autocomplete="off" spellcheck="false">'):'';
      // The open popover renders IN FLOW below the chip row (openSrcPop), pushing the bundle section down —
      // absolutely positioned inside the chip it sat on top of the Auto / Choose-manually radios.
      if(open) openSrcPop=('<div class="cfg-srcdd-pop"><div class="cfg-srcdd-hd"><b>'+esc(s.name)+'</b><button class="cfg-srcdd-all" data-act="src-all" data-src="'+esc(s.id)+'">'+((sel===tot&&tot)?'Select none':'Select all')+'</button></div>'+srch+'<div class="cfg-srcdd-list" id="srcddList">'+rows+'</div></div>');
      return '<span class="cfg-srcdd"><span class="cfg-chip btn-chip'+(sel?' on':'')+'" data-act="src-dd" data-src="'+esc(s.id)+'" role="button" tabindex="0" aria-haspopup="true" aria-expanded="'+(open?'true':'false')+'"><b>'+esc(s.name)+'</b>'+(sel?'<span class="chk">✓</span>':'')+'<span class="cfg-chip-sub">· '+esc(srcChipCount(s.kind,sel,tot))+'</span><span class="cfg-caret">'+(open?'▾':'▸')+'</span></span></span>';
    }).join(''):'<span class="cfg-chip-empty">No sources connected. Go to <b>Connect</b> first.</span>';
    // Decision 2: data planes and memory recall are EXPLICIT per-run choices — nothing ticked by
    // default; the server mounts only what planeFilter / memoryRecall name (src/run/planeSelection.ts).
    var pc=planeChoices(state.sources);
    var planeBlock='<span class="eyebrow cfg-lab" style="margin-top:14px">Data sources</span>'+planePickerHtml(pc,state.planeSel,'');
    // One-line scope summary + the confirm step for a wide (>5 repos) or live-data (any plane) run.
    var cnt={github:0,giturl:0,local:0};
    state.sources.forEach(function(s){ if(cnt[s.kind]==null) return; (s.artifacts||[]).forEach(function(a){ if(state.artSel[s.id+'::'+a.id]!==false) cnt[s.kind]++; }); });
    var nPlaneSel=pc.planes.filter(function(p){ return state.planeSel[p.id]===true; }).length;
    var cap=(state.effectiveRunBudget===0)?0:state.runBudget;
    var sum=scanSummary({ repos:cnt.github, publicRepos:cnt.giturl, folders:cnt.local, planes:nPlaneSel, bundles:ov?nBunSel:null, memoryRecall:state.memRecall===true, siblingRecall:state.siblingRecall===true, saveLearnings:state.orgWriteMemory===true, publicOnly:(cnt.giturl>0&&!cnt.github&&!cnt.local&&state.sources.every(function(s){ return s.kind==='giturl'; })), cap:cap });
    var dups=duplicateRepoTargets(state.sources,state.artSel);   // the same repo through two sources
    var dupWarn=dups.length?'<div class="cfg-sum-warn">'+dups.map(function(d){ return esc(d.repo)+' is ticked in '+esc(d.sources.join(' and '))+' — it would be scanned twice; untick one.'; }).join('<br>')+'</div>':'';
    ensureBaselineInfo();   // incremental re-scan: (re)fetch the baseline preview when the target selection changed
    var summaryHtml='<div class="cfg-sum" id="cfgSummary" aria-live="polite"><b>This run:</b> '+esc(sum.text)+(sum.warn?'<div class="cfg-sum-warn">'+esc(sum.warn)+'</div>':'')+dupWarn+'<div id="cfgBaseline">'+baselineHtml()+'</div></div>';
    var startDisabled=(!nSel||needTok||(ov&&nBunSel===0));
    var confirmHtml=(state.scanConfirm&&!startDisabled)
      ?'<div class="cfg-confirm" role="alertdialog" aria-label="Confirm run scope"><b>Confirm the scope.</b> '+esc(sum.text)+'.'
        +(nPlaneSel?' The agents will query the ticked live data sources read-only.':'')
        +'<div class="cfg-confirm-acts"><button class="btn honey" data-act="startrun-confirm">Confirm &amp; run →</button><button class="btn ghost" data-act="startrun-back">Back</button></div></div>'
      :'';
    host.innerHTML='<div class="rd-stack">'
      +'<div class="rd-card">'
      +'<div class="cfg-head"><div class="cfg-head-l"><span class="cfg-eyebrow">NEW RUN</span><span class="cfg-title">Configure a full scan</span></div><button class="cfg-cancel" data-act="cancel-config">Cancel</button></div>'
      +'<p class="cfg-intro">Point accel-scope at your connected sources — read-only. First <b>Comprehend</b> classifies your system and picks the expert <b>bundles</b> (areas such as Data Eng or Security) that fit; each bundle then poses and measures problems end-to-end.</p>'
      +'<div class="cfg-grid">'
      +'<div class="cfg-col">'
      +'<span class="eyebrow cfg-lab">Scope label</span>'
      +'<input id="cfgScope" class="cfg-scope" type="text" autocomplete="off" placeholder="e.g. Series-B data room readiness" value="'+esc(state.scopeText||'')+'">'
      +'<span class="eyebrow cfg-lab" style="margin-top:14px">Brief (optional)</span>'
      +'<textarea id="engagementBrief" rows="7" maxlength="8000" placeholder="e.g. prepping a Series-B data room; the revenue dashboard is not fully trusted; focus on the billing pipeline." class="cfg-brief mono">'+esc(state.briefText||'')+'</textarea>'
      +'</div>'
      +'<div class="cfg-col">'
      +'<span class="eyebrow cfg-lab">Code to scan</span>'
      +'<div class="cfg-chips">'+srcChips+'</div>'+(openSrcPop?'<div class="cfg-srcdd cfg-srcdd-panel">'+openSrcPop+'</div>':'')
      +'<span class="eyebrow cfg-lab" style="margin-top:14px">Expert bundles</span>'
      +'<div role="radiogroup" aria-label="Expert bundles">'
      +'<div class="cfg-radio'+(ov?'':' on')+'" data-act="bundles-auto" role="radio" tabindex="0" aria-checked="'+(ov?'false':'true')+'"><span class="cfg-radio-dot" aria-hidden="true"></span><span class="cfg-radio-txt"><b>Auto — Comprehend picks</b><span class="cfg-radio-sub">Classifies your system and activates the right expert bundles.</span></span></div>'
      +'<div class="cfg-radio'+(ov?' on':'')+'" data-act="bundles-manual" role="radio" tabindex="0" aria-checked="'+(ov?'true':'false')+'"><span class="cfg-radio-dot" aria-hidden="true"></span><span class="cfg-radio-txt"><b>Choose manually</b><span class="cfg-radio-sub">Pick the exact bundle set yourself.</span></span></div>'
      +'</div>'
      // UI-19: a Select all / none toggle over the manual list (per-bundle descriptions skipped — the UI carries only
      // the display-name map, not the registry's lens text).
      +(ov?('<div class="cfg-bun-hd"><button type="button" class="cfg-srcdd-all" data-act="bundles-all">'+(nBunSel===BUNDLES.length?'Select none':'Select all')+'</button></div><div class="cfg-list cfg-bunwrap" role="group" aria-label="Bundles to run">'+bunList+'</div>'):'')
      +planeBlock
      +'</div>'
      +'</div>'
      // Memory recall is its own visible per-run toggle (default OFF, remembered with the rest).
      +'<label style="display:flex;align-items:center;gap:7px;font-size:14px;margin-top:14px"><input type="checkbox" id="orgMemoryRecall"'+(state.memRecall===true?' checked':'')+'><span>Recall memory <span style="color:var(--muted)">— prior findings + learned methods as re-verify context</span></span></label>'
      // Cross-project memory: the per-run opt-in (default OFF) — sibling-project facts as CONTRAST for Critic + Expert.
      +'<label style="display:flex;align-items:center;gap:7px;font-size:14px;margin-top:8px"><input type="checkbox" id="orgSiblingRecall"'+(state.siblingRecall===true?' checked':'')+'><span>Compare with my other projects <span style="color:var(--muted)">— what your other scanned projects recorded about the same metrics, tables and practices, as leads to verify</span></span></label>'
      +'<label style="display:flex;align-items:center;gap:7px;font-size:14px;margin-top:8px"><input type="checkbox" id="orgWriteMemory"'+(state.orgWriteMemory===true?' checked':'')+'><span>Save learnings to memory <span style="color:var(--muted)">— after the run, durable facts it verified are added to your local memory — reviewable and revertable in Memory → History</span></span></label>'
      +((CODEINTEL_AVAIL&&RUNMODE==='agentic')?'<label style="display:flex;align-items:center;gap:7px;font-size:14px;margin-top:10px"><input type="checkbox" id="orgCodeintel"'+(state.orgCodeintel===false?'':' checked')+'> Code intelligence <span style="color:var(--muted)" title="indexed with repowise">— cross-repo code index + maps in the report</span></label>':'')
      +summaryHtml
      +'<div class="cap-row">'+capLineHtml()+'</div>'
      +(confirmHtml||('<button class="btn honey" id="startBtn" data-act="startrun"'+(startDisabled?' disabled':'')+' style="width:100%;height:44px;margin-top:12px">Run full scan →</button>'))
      +(!nSel?'<div class="hint" style="margin-top:8px">Nothing is selected yet — tick the repos / folders to scan under Code to scan.</div>':'')
      +((ov&&nBunSel===0)?'<div class="hint" style="color:#B3401F;margin-top:8px">Choose manually is on — tick at least one bundle, or switch to Auto.</div>':'')
      +(needTok?keyGateHtml():'')
      +(state.runError?'<div class="hint" style="color:#C0392B;margin-top:8px">'+esc(state.runError)+'</div>':'')
      +'</div>'
      // This card is a STATIC explainer of the pipeline shape (every candidate bundle drawn), not a live run.
      +'<div class="rd-card"><div class="cfg-bar" style="margin-bottom:6px"><span class="eyebrow">How a full scan runs · illustration, not this run</span><span class="eyebrow" style="color:var(--honey-link)">Comprehend branches → Critic · Preflight · Expert per bundle → Leadership + Execution reports</span></div>'
      +'<p class="cfg-intro" style="margin-bottom:12px">Comprehend classifies the company and activates expert bundles (or you pick them manually); each active bundle runs its own Critic → Preflight → Expert lane in parallel. The lanes converge into Synthesis + Findings, and the run ships two reports: a Leadership brief (what to act on first) and an Execution report (per finding: fix, done when, how to verify — plus a REMEDIATION.md export).</p>'
      +'<div class="tl">'+timelineHtml({status:'config'},{},-1)+'</div></div></div>';
    if(state.openSrc) filterSrcRows();   // re-apply the source-dropdown search after this config re-render (e.g. an item toggle)
    // Live target search — filters the rendered TARGET list via the DOM (show/hide), so typing never
    // re-renders the config card and the input keeps focus. The term lives in state.targetFilter so an
    // item-toggle re-render (which DOES rebuild this card) re-applies it from the restored input value.
    // Target list + live search were removed with the new full-scan layout — all targets scan by default.
  }
  // Show/hide the open source-dropdown's rows against state.srcQuery (DOM-only, so typing keeps focus). Mirrors
  // filterReposRows for the Quick Ask repo picker.

  function filterSrcRows(){
    var q=(state.srcQuery||'').toLowerCase().trim();
    var box=document.getElementById('srcddList'); if(!box) return;
    var rows=box.querySelectorAll('[data-srcq]');
    for(var i=0;i<rows.length;i++){ var hay=rows[i].getAttribute('data-srcq')||''; rows[i].style.display=(!q||hay.indexOf(q)>=0)?'':'none'; }
  }
  // Show/hide TARGET rows against state.targetFilter; a source group header hides when all its rows are hidden.
  function filterTargets(){
    var list=document.getElementById('cfgTargetList'); if(!list) return;
    // When the search box isn't rendered (target count dropped to ≤6 after a source change), never apply a
    // stale state.targetFilter — there'd be no visible box to clear it, so the list would look broken.
    var q=document.getElementById('targetSearch')?(state.targetFilter||'').trim().toLowerCase():'';
    var kids=list.children, grp=null, grpVis=false, shown=0, total=0;
    function flush(){ if(grp) grp.style.display=grpVis?'':'none'; }
    for(var i=0;i<kids.length;i++){ var el=kids[i];
      if(el.classList&&el.classList.contains('cfg-group')){ flush(); grp=el; grpVis=false; continue; }
      if(el.getAttribute&&el.getAttribute('data-art')!=null){ total++;
        var hit=!q||(el.textContent||'').toLowerCase().indexOf(q)>=0;
        el.style.display=hit?'':'none'; if(hit){ grpVis=true; shown++; } }
    }
    flush();
    var nm=document.getElementById('cfgNoMatch'); if(nm) nm.style.display=(q&&!shown&&total)?'':'none';
  }
  // ---------- checkpoint / resume ----------
  var CK_ORDER=['workspace','comprehend','frontier','barrier','claim-audit','synthesis','findings','reports','reconciled','combined'];
  function ckRank(id){ return CK_ORDER.indexOf(id); }
  // The checkpoint list the UI should trust: the FETCHED /checkpoints rows (server-side self-healed
  // from the sidecar files) when available, else the state index. A crash can lose the state.json tail
  // (or ALL rows) while the sidecars survive — gating anything on run.checkpoints alone would then
  // hide every resume affordance and never trigger the heal.
  function ckListOf(run){
    var info=(state.ckInfo||{})[run.id];
    if(info&&info!=='loading'&&(info.checkpoints||[]).length) return info.checkpoints;
    return run.checkpoints||[];
  }
  function ckEligible(run){ return run.mode==='agentic' && (!run.kind||run.kind==='org'); }
  function ckResumable(run){ return ckEligible(run) && ckListOf(run).length>0; }
  function bundleLabelOf(id){ for(var i=0;i<BUNDLES.length;i++) if(BUNDLES[i].key===id) return BUNDLES[i].label; return id; }
  // Per-run resume dry-run (compat vs the running code + reconnect needs), fetched lazily.
  function loadCkInfo(runId){
    state.ckInfo=state.ckInfo||{};
    if(state.ckInfo[runId]) return;
    state.ckInfo[runId]='loading';
    api('/api/runs/'+encodeURIComponent(runId)+'/checkpoints').then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.json(); }).then(function(d){
      state.ckInfo[runId]=(d&&d.checkpoints)?d:{checkpoints:[],reconnects:[]};
      scheduleDetailRender();
    }).catch(function(){ state.ckInfo[runId]={__err:true,checkpoints:[],reconnects:[]}; scheduleDetailRender(); });
  }
  function compatPill(c){
    if(!c) return '';
    if(c.compat==='ok') return '<span class="sbadge ok">✓ compatible</span>';
    if(c.compat==='code_changed') return '<span class="sbadge" title="made by an earlier version of accel-scope — resuming still works; results may differ slightly">older build · reusable</span>';   // polish: plain words, not the producer-SHA compatWhy
    return '<span class="sbadge err" title="'+esc(c.compatWhy||'stage schema mismatch — fail-closed')+'">✗ incompatible</span>';
  }
  // Incremental re-scan note (run hero: first max lines; Checkpoints card: all — which lanes were reused, why the rest re-ran).
  function incrHtml(run,max){
    var ls=incrementalNote(run&&run.incremental); if(!ls.length) return '';
    var shown=ls.slice(0,max), more=ls.length-shown.length;
    return '<div class="rd-incr"><b>'+esc(shown[0])+'</b>'+shown.slice(1).map(function(l){ return '<div class="rd-incr-sub">'+esc(l)+'</div>'; }).join('')+(more>0?'<div class="rd-incr-sub">+'+more+' more in the Checkpoints card</div>':'')+'</div>';
  }
  function checkpointsCard(run){
    var cks=ckListOf(run); if(!cks.length) return '';
    var info=(state.ckInfo||{})[run.id]; var infoById={};
    if(info&&info!=='loading') (info.checkpoints||[]).forEach(function(c){infoById[c.id]=c;});
    var canStart=run.status!=='running' && ckResumable(run);
    var rows=cks.map(function(c,i){
      var latest=i===cks.length-1;
      var ic=infoById[c.id];
      var startable=canStart && c.id!=='combined' && (!ic||ic.compat!=='incompatible');
      var start=startable?'<button class="btn ghost" data-act="open-resume" data-id="'+esc(run.id)+'" data-ck="'+esc(c.id)+'" title="Opens the resume pane. Starting the new run is PAID — every stage after this checkpoint re-runs'+(costHintText(run.costUsd)?(' (the original run cost '+esc(costHintText(run.costUsd))+')'):'')+'." style="padding:6px 13px;font-size:13px;flex:none">Start run from here <span class="paid-tag">paid</span></button>':'';   // A paid re-run is labeled as such
      return '<div class="ck-row'+(latest?' latest':'')+'"><span class="ck-dia">◆</span>'
        +'<div class="ck-main"><div class="ck-name">'+esc(c.label)+(latest?'<span class="latest-tag">latest</span>':'')+compatPill(ic)+'</div>'
        +(c.detail?'<div class="ck-sub" title="'+esc(c.detail)+'">'+esc(c.detail)+'</div>':'')
        +'<div class="ck-meta">saved '+esc(relTime(c.at))+(c.spentUsd!=null?' · '+esc(money(c.spentUsd))+' spent by then':'')+'</div></div>'
        +start+'</div>';
    }).join('');
    var scroll=cks.length>3?' ck-scroll':'';   // show ~3, scroll the rest
    return '<div class="rd-card flush"><div class="rd-sec-head"><h3>Checkpoints</h3><span class="eyebrow">self-consistent cuts · resume anchors</span></div>'+(run.incremental&&run.incremental.mode!=='full'?'<div style="padding:0 16px 8px">'+incrHtml(run,99)+'</div>':'')+'<div class="rd-outs'+scroll+'">'+rows+'</div></div>';
  }
  // The "what will run" preview plan for the resume pane — drives node/lane statuses via previewPlan.
  function resumePreviewPlan(sel){
    var rk=ckRank(sel.id);
    var reuse=(state.resumeOpen&&state.resumeOpen.reuse)||{};
    var note=sel.id==='findings'?'findings reused — only the report writers re-run (iteration anchor)'
      :sel.id==='frontier'?'completed lanes reused; missing / unticked lanes re-run from their own Critic'
      :sel.id==='barrier'?'ticked lanes reused (untick any to re-run it) — claim audit onward re-runs'
      :sel.id==='workspace'?'workspace rebuilt @ pinned SHAs — every agent stage re-runs'
      :sel.id==='comprehend'?'classification + bundle choice reused — all lanes re-run'
      :sel.id==='synthesis'?'synthesis reused — findings + reports re-run'
      :'leadership brief reused — only the Execution report is re-rendered';
    var anyRerun=false; (sel.bundlesDone||[]).forEach(function(id){ if(reuse[id]===false) anyRerun=true; });
    var effRk=(anyRerun&&rk>ckRank('barrier'))?ckRank('barrier'):rk;   // a re-running lane invalidates everything after the barrier
    return {
      note:note+((anyRerun&&rk>ckRank('barrier'))?' · a lane re-runs → clamped to the barrier':''),
      node:function(stageKey){
        if(stageKey==='comprehend') return effRk>=ckRank('comprehend')?'cached':'queued';
        if(stageKey==='synthesize') return effRk>=ckRank('synthesis')?'cached':'queued';
        if(stageKey==='findings') return effRk>=ckRank('findings')?'cached':'queued';
        if(stageKey==='report') return effRk>=ckRank('reports')?'cached':'queued';
        return 'queued';
      },
      lane:function(bundle){
        if(effRk>=ckRank('barrier')) return reuse[bundle]===false?'queued':'cached';
        if(sel.id==='frontier') return ((sel.bundlesDone||[]).indexOf(bundle)>=0&&reuse[bundle]!==false)?'cached':'queued';
        return 'queued';
      }
    };
  }
  // The 4th right-pane state: resume config for the SELECTED run (checkpoint picker · per-bundle reuse ·
  // pinned inputs · reconnect dry-run · what-will-run preview). POSTs resumeFrom → a NEW child run.
  function renderResumePane(host,run){
    loadCkInfo(run.id);
    var info=(state.ckInfo||{})[run.id];
    if(!info||info==='loading'){ host.innerHTML='<div class="rd-empty">Loading checkpoints… <button class="cfg-cancel" data-act="resume-cancel" style="margin-left:10px">← Back to run</button></div>'; return; }
    // A failed fetch is NOT "no checkpoints" — offer retry instead of a false empty state.
    if(info.__err){ host.innerHTML='<div class="rd-empty">Could not load this run’s checkpoints. <button class="cfg-cancel" data-act="resume-retry" style="margin-left:10px">Retry</button> <button class="cfg-cancel" data-act="resume-cancel" style="margin-left:6px">← Back to run</button></div>'; return; }
    var picks=(info.checkpoints||[]).filter(function(c){return c.id!=='combined';});
    if(!picks.length){ host.innerHTML='<div class="rd-empty">No resumable checkpoints on this run. <button class="cfg-cancel" data-act="resume-cancel" style="margin-left:10px">Back</button></div>'; return; }
    var sel=null,i;
    for(i=0;i<picks.length;i++) if(picks[i].id===state.resumeOpen.ckpt) sel=picks[i];
    if(!sel||sel.compat==='incompatible'){ sel=null; for(i=picks.length-1;i>=0;i--) if(picks[i].compat!=='incompatible'){ sel=picks[i]; break; } }
    if(!sel){ host.innerHTML='<div class="rd-empty">Every checkpoint on this run is incompatible with the current code. <button class="cfg-cancel" data-act="resume-cancel" style="margin-left:10px">Back</button></div>'; return; }
    state.resumeOpen.ckpt=sel.id;
    // The EFFECTIVE cut (server-side contiguity clamp): if the chain has a hole below the selected
    // row, the server resumes from row.effective instead — preview/toggles/reconnects follow THAT cut.
    var eff=sel; if(sel.effective&&sel.effective!==sel.id){ for(i=0;i<picks.length;i++) if(picks[i].id===sel.effective) eff=picks[i]; }
    var tickable=(eff.id==='frontier'||eff.id==='barrier')?(eff.bundlesDone||[]):[];
    if(state.resumeOpen.reuseFor!==eff.id){ state.resumeOpen.reuse={}; state.resumeOpen.reuseFor=eff.id; }
    var purpose=run.status==='complete'
      ?'Iteration reuse — inputs are pinned to this run; downstream stages re-run on the CURRENT code.'
      :'Fault recovery — pick up where the run left off; only the remaining stages run.';
    var pickerRows=picks.map(function(c){
      var dis=c.compat==='incompatible';
      return '<div class="cfg-item'+(c.id===sel.id?' sel':'')+(dis?' disabled':'')+'"'+(dis?'':' data-act="resume-pick" data-ck="'+esc(c.id)+'"')+'>'
        +'<span class="radio"></span>'
        +'<span class="cfg-lbl" style="min-width:0"><b>'+esc(c.label)+'</b><span style="display:block;margin-top:2px;font-family:var(--font-mono);font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(c.detail||'')+'</span></span>'
        +compatPill(c)
        +'<span class="cfg-sub">'+esc(relTime(c.at))+'</span></div>';
    }).join('');
    var reuseHtml='';
    if(tickable.length){
      var rrows=tickable.map(function(id){
        var on=state.resumeOpen.reuse[id]!==false;
        return '<div class="cfg-item" data-act="resume-toggle" data-b="'+esc(id)+'"><span class="cbx'+(on?' on':'')+'"></span>'
          +'<span class="cfg-lbl" style="min-width:0"><b>'+esc(bundleLabelOf(id))+'</b><span style="display:block;margin-top:2px;font-family:var(--font-mono);font-size:10.5px;color:var(--muted)">'+(on?'reuse the measured lane · verdicts + area report carried forward · $0':'forced re-run — this lane executes again on current code')+'</span></span>'
          +'<span class="cfg-sub"'+(on?'':' style="color:var(--high)"')+'>'+(on?'reuse':'re-run')+'</span></div>';
      }).join('');
      reuseHtml='<div class="cfg-bar"><span class="eyebrow">Reuse per bundle</span><span class="eyebrow" style="color:var(--honey-link)">lanes are independent — any subset is a valid cut</span></div>'
        +'<div class="cfg-list">'+rrows+'</div>'
        +'<div class="hint">untick a completed bundle to force just that lane to re-run (e.g. you changed that bundle’s logic); everything after the barrier then re-runs too. Lanes not on the frontier restart from their own Critic.</div>';
    }
    var needPlanes=ckRank(eff.id)<=ckRank('barrier');
    var needAttention=0;
    var rcHtml=(info.reconnects||[]).map(function(x){
      var needed=x.need==='always'||needPlanes;
      var right;
      if(!needed) right='<span class="rc-ok" style="color:var(--muted)">— not needed after this checkpoint</span>';
      else if(x.ok) right='<span class="rc-ok">✓ ready</span>';
      else { needAttention++; right='<span class="rc-warn">⚠ reconnect needed</span>'; }
      return '<div class="rc-row"'+(!needed?' style="opacity:.55"':'')+'><div class="rc-main"><div class="rc-n">'+esc(x.label)+'</div><div class="rc-s">'+esc(x.detail||'')+'</div></div>'+right+'</div>';
    }).join('');
    var nRepo=(run.repoFilter||[]).length, nLocal=(run.localFilter||[]).length;
    var target=[nRepo?plural(nRepo,'repo')+' @ recorded SHAs':'',nLocal?plural(nLocal,'local folder')+' (re-copied live)':''].filter(Boolean).join(' + ')||run.targetName||'—';
    var bundlesTxt=(run.bundles&&run.bundles.length)?('manual selection · '+run.bundles.join(', ')):'Comprehend’s recorded choice (replayed)';
    var brief=String(run.brief||'').trim();
    var plan=resumePreviewPlan(eff);
    previewPlan=plan;
    var previewHtml=timelineHtml(run,stageCounts(),stageIdx(latestStage()));
    previewPlan=null;
    var spent=eff.spentUsd!=null?money(eff.spentUsd):null;
    host.innerHTML='<div class="rd-stack"><div class="rd-grid">'
      +'<div class="rd-col"><div class="rd-card">'
        +'<div class="cfg-head"><div><div class="eyebrow" style="margin-bottom:5px">'+(run.status==='complete'?'Iterate · reuse checkpoint':'Recover · resume run')+'</div><span class="cfg-title">Resume from checkpoint</span></div><button class="cfg-cancel" data-act="resume-cancel">← Back to run</button></div>'
        +'<div class="resume-banner"><div class="t">from '+esc(run.alias?run.alias+' · '+runTitle(run):runTitle(run))+'</div><div class="s">'+esc(purpose)+'</div></div>'
        +'<div class="cfg-bar" style="margin-top:0"><span class="eyebrow">From checkpoint</span><span class="eyebrow" style="color:var(--honey-link)">creates a NEW run · this run stays unchanged</span></div>'
        +'<div class="cfg-list">'+pickerRows+'</div>'
        +'<div class="hint">older build = produced by an earlier version of the app — still reusable; that IS the iteration case. ✗ incompatible = the stage schema no longer matches; fail-closed.</div>'
        +(eff!==sel?'<div class="hint" style="color:var(--high)">⚠ the checkpoint chain has a hole below “'+esc(sel.label)+'” — the resume will actually start from “'+esc(eff.label)+'” (the preview shows that).</div>':'')
        +reuseHtml
        +'<div class="cfg-bar"><span class="eyebrow">Inputs · pinned to this run</span><span class="eyebrow" style="text-align:right">edit inputs ⇒ fresh run</span></div>'
        +'<div class="cfg-list" style="padding:10px 12px">'
          +'<div class="pin-row"><span class="k">target</span><span class="v">'+esc(target)+'</span></div>'
          +(brief?'<div class="pin-row"><span class="k">brief</span><span class="v">“'+esc(brief.slice(0,160))+(brief.length>160?'…':'')+'”</span></div>':'')
          +'<div class="pin-row"><span class="k">bundles</span><span class="v">'+esc(bundlesTxt)+'</span></div>'
          +'<div class="pin-row"><span class="k">memory</span><span class="v">memory recall '+(run.useMemory===false?'OFF':'ON')+' (as this run)</span></div>'
        +'</div>'
        +'<div class="cfg-bar"><span class="eyebrow">Reconnect check</span>'+(needAttention?'<span class="eyebrow" style="color:var(--high)">'+needAttention+' source(s) need attention — reconnect in Connect</span>':'<span class="eyebrow" style="color:var(--ok)">all sources ready</span>')+'</div>'
        +rcHtml
        +'<div class="cost-note">⟳ reused stages replay at <b>$0</b> — you pay only for what re-runs.'+(spent?' This run had spent '+esc(spent)+' by this checkpoint.':'')+'</div>'
        +'<button class="btn honey" data-act="resume-go" style="width:100%;height:44px"'+(needAttention?' disabled':'')+'>Resume run →</button>'
        +(state.resumeError?'<div class="hint" style="color:#C0392B;margin-top:8px">'+esc(state.resumeError)+'</div>':'')
        +(needAttention?'<div class="hint" style="color:var(--high)">reconnect the flagged source(s) in Connect (or pick a later checkpoint that doesn’t need them) to enable Resume.</div>':'')
      +'</div></div>'
      +'<div class="rd-col"><div class="rd-card flush"><div class="rd-sec-head"><h3>What will run</h3><span class="eyebrow">'+esc(plan.note)+'</span></div><div class="tl">'+previewHtml+'</div></div></div>'
    +'</div></div>';
  }
  function resumeGo(){
    var run=activeRun(); if(!run||!state.resumeOpen) return;
    var info=(state.ckInfo||{})[run.id]; if(!info||info==='loading') return;
    if(!confirm(actionConfirmText('resume',{costUsd:run.costUsd}))) return;   // A resume is a new PAID run
    var ck=state.resumeOpen.ckpt; var sel=null;
    (info.checkpoints||[]).forEach(function(c){ if(c.id===ck) sel=c; });
    // The lane toggles belong to the EFFECTIVE cut (the server-side contiguity clamp) — the pane
    // renders them from it, so the POST must too, or an untick shown under a clamped selection
    // would be silently dropped.
    var effId=(sel&&sel.effective)?sel.effective:ck; var effRow=null;
    (info.checkpoints||[]).forEach(function(c){ if(c.id===effId) effRow=c; });
    var body={resumeFrom:{runId:run.id,checkpoint:ck}};
    if(effRow&&(effRow.id==='frontier'||effRow.id==='barrier')){
      var all=effRow.bundlesDone||[];
      var ticked=all.filter(function(id){return state.resumeOpen.reuse[id]!==false;});
      if(ticked.length!==all.length) body.resumeFrom.reuseBundles=ticked;
    }
    api('/api/runs',{method:'POST',body:body}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(res){
      if(!res.ok){ state.resumeError=res.d.error||'Failed to resume.'; renderRunDetail(); return; }
      state.resumeOpen=null; state.resumeError='';
      state.activeRunId=res.d.id; state.detailLoadedId=null; state.detailEvents=[]; state.detailStageNow=null; state.detailStageByBundle=null; state.detailBundles=null; state.detailCached=null; state.stagePinned=false;
      if(currentView()==='run') history.replaceState(null,'','/run?run='+encodeURIComponent(res.d.id));
      loadState();
    }).catch(function(){ state.resumeError='Network error — could not resume.'; renderRunDetail(); });
  }
  // Shared accel-mini ask detail — the FULL run-result view (header card + intake question + vertical
  // Pipeline + Run log + Memory / Run output row). Rendered by BOTH the Full Scan run page (/run?run=<ask>,
  // evId 'runEventStream') and the Quick Ask tab's history detail (evId 'askEventStream') — the two panels
  // coexist in the DOM, so each host owns a UNIQUE event-stream element id.
  function askDetailHtml(run,evId){
    var qtext=String(run.question||run.askQuestion||run.targetName||'').trim();
    var evs=(state.detailLoadedId===run.id)?state.detailEvents:[];   // the ONE stream buffer belongs to the attached run only
    var aEvf=filterEventRows(evs,state.hideToolEvents===true);   // UI-10
    var aEventHtml=aEvf.rows.length?aEvf.rows.map(function(e){
      return '<div class="ev-row nostage '+esc(e.kind)+'"><span class="ev-idx">#'+e.idx+'</span><span class="ev-ts">'+esc(fmtTime(e.t))+'</span><span class="ev-msg">'+esc(stripWorkspacePath(e.msg))+'</span></div>';
    }).join(''):'<div class="ev-empty">'+(aEvf.hidden?(aEvf.hidden+' tool call'+(aEvf.hidden===1?'':'s')+' hidden'):'waiting for log…')+'</div>';
    var aStream=run.status==='running'?(state.detailStream?'● live':'● tailing'):run.status==='complete'?'✓ complete':run.status;
    // Deck Quick-Ask result HERO: scope eyebrow · big question title · the intake question · a sub-line, with
    // status on the right and an action row (Open answer → / Run full scan → / est. cost). Replaces the generic
    // run-detail id-header + metric cells + separate Intake card (deck folds the question into the hero).
    var scopeLbl=String(run.scope||run.askScope||'').trim();
    var ah='<div class="rd-stack">'
      +'<div class="rd-card ask-hero">'
      +'<div class="ask-hero-row"><div class="ask-hero-main">'
        +'<div class="ask-hero-eyebrow">'+esc(scopeLbl||run.alias||'Quick Ask')+' <button type="button" class="rd-rename" data-act="rename-run" data-id="'+esc(run.id)+'" aria-label="Rename" title="Rename this run">✎</button></div>'
        +'<h2 class="ask-hero-title">'+esc(runTitle(run))+'</h2>'
        +(qtext?'<p class="ask-hero-q">'+esc(qtext)+'</p>':'')
        +'<p class="ask-hero-sub">one investigate agent · read-only'+(run.error?' · '+esc(run.error):'')+'</p>'
      +'</div><div class="ask-hero-side">'+statusBadge(run.status)+'</div></div>'
      +'<div class="ask-hero-acts">'
        +(run.status==='running'?'<button class="btn ghost" data-act="stop-run" data-id="'+esc(run.id)+'">Stop</button>':run.status==='complete'?'<button class="btn honey openrep" data-id="'+esc(run.id)+'">Open answer &rarr;</button>':'')
        +'<button class="btn ghost" data-act="newrun">Run full scan &rarr;</button>'
        +'<span class="ask-hero-cost">'+esc(costWord(run.status))+' <b>'+esc(money(run.costUsd))+'</b></span>'   // The actual cost once terminal
      +'</div></div>'
      +degradedBannerHtml(degradedRows(run,null));   // run health: translate / salvage / skipped repos / budget rows
    // Two-column layout mirroring the Full Scan run page: taller VERTICAL pipeline on the left, the live
    // Terminal on the right. Once complete, the QuickAsk memory card (pattern recognized) moves DOWN into
    // a Memory (left) + Run output (right) row — same side-by-side pairing as the Full Scan detail.
    var aDone=run.status==='complete', aErr=run.status==='error';
    var s1cls=aDone?'done':(aErr?'wait':'running'), s1sym=aDone?'✓':'1';
    var s2cls=aDone?'done':'wait', s2sym=aDone?'✓':'2';
    var askPipe='<div class="rd-card"><div class="eyebrow">Pipeline</div><div class="pipe-v">'
      +'<div class="pv-stage"><div class="pv-rail"><span class="pv-dot '+s1cls+'">'+s1sym+'</span><span class="pv-line"></span></div>'
        +'<div class="pv-body"><h3>Investigate</h3><p>one read-only agent · grounded in refs</p>'
        +'<ul class="pv-sub"><li><span class="d">—</span> load connected repos + planes</li><li><span class="d">—</span> recall memory cards</li><li><span class="d">—</span> quantify from real data</li></ul></div></div>'
      +'<div class="pv-stage"><div class="pv-rail"><span class="pv-dot '+s2cls+'">'+s2sym+'</span></div>'
        +'<div class="pv-body"><h3>Report</h3><p>self-contained HTML</p>'
        +'<ul class="pv-sub"><li><span class="d">—</span> grounded answer + evidence</li><li><span class="d">—</span> pattern-recognition pass</li></ul></div></div>'
      +'</div></div>';
    var aLogCard='<div class="rd-card flush"><div class="rd-sec-head"><h3>Run log</h3><span class="ev-head-r">'+eventFilterChip(state.hideToolEvents===true,aEvf.hidden)+'<span class="eyebrow">'+esc(aStream)+'</span></span></div><div class="ev-stream" id="'+esc(evId)+'">'+aEventHtml+'</div></div>';
    // While the run is live (or errored) any recognized card still reads under the log; on complete it
    // relocates to the Memory + Run output row below so the two land side by side.
    ah+='<div class="rd-grid">'+askPipe+'<div class="rd-col">'+aLogCard+(run.status==='complete'?'':renderRecognitionTerminal(run))+'</div></div>';
    if(run.status==='complete'){
      var aouts=[{n:'Report',s:'self-contained HTML · grounded answer',act:'<button class="btn ghost openrep" data-id="'+esc(run.id)+'" style="padding:6px 13px;font-size:13px">Open</button>'}].concat(run.hasTrace?[
        {n:'Run trace',s:'agent trajectory + tool tally · provenance',act:'<a class="btn ghost" href="/api/runs/'+encodeURIComponent(run.id)+'/trace" target="_blank" rel="noopener" style="padding:6px 13px;font-size:13px;text-decoration:none">Open</a>'}]:[]);
      var aOutHtml='<div class="rd-card flush"><div class="rd-sec-head"><h3>Run output</h3></div><div class="rd-outs">'+aouts.map(function(o){return '<div class="rd-out"><div><strong>'+esc(o.n)+'</strong><br><span class="s">'+esc(o.s)+'</span></div>'+o.act+'</div>';}).join('')+'</div></div>';
      // Memory (left) + Run output (right) side by side, mirroring the Full Scan detail; Run output
      // spans full width alone when the ask matched no pattern.
      var aMemHtml=renderRecognitionTerminal(run);
      ah+=aMemHtml?('<div class="rd-grid">'+aMemHtml+aOutHtml+'</div>'):aOutHtml;
      // Post-run Memory surface: only when this run had the "Save learnings to memory" tick set. Lazy-fetches
      // this run's OWN memory writes (/api/memory/history?run_id=<run.id>) and lists what got added. Fail-open.
      if(run.writeMemory===true) ah+=renderAskMemoryAdds(run);
    }
    ah+='</div>';
    return ah;
  }
  function renderRunDetail(){
    var host=document.getElementById('runDetail'); if(!host) return;
    if(state.configOpen){ renderRunConfig(host); renderNodeModal(); return; }
    var run=activeRun();
    if(!run){ host.innerHTML='<div class="rd-empty">No run selected. Pick one from history, or start a <b style="color:var(--espresso)">New full scan</b>.</div>'; renderNodeModal(); return; }
    if(state.resumeOpen&&state.resumeOpen.runId===run.id&&run.kind!=='ask'){ renderResumePane(host,run); renderNodeModal(); return; }
    if(run.status!=='running'&&ckEligible(run)) loadCkInfo(run.id);   // ALWAYS probe (self-heals a lost index) + fills the compat pills lazily
    // accel-mini "ask" runs render a MINIMAL detail — raw intake question + run log + result/report — and
    // SKIP the conventional Pipeline timeline + branching-node graph (there is no hypothesis pipeline here).
    if(run.kind==='ask'){
      var ah=askDetailHtml(run,'runEventStream');
      var aOld=document.getElementById('runEventStream'); var aPrevTop=aOld?aOld.scrollTop:0; var aPrevNear=aOld?(aOld.scrollHeight-aOld.scrollTop-aOld.clientHeight<60):true;
      host.innerHTML=ah;
      var aBox=document.getElementById('runEventStream'); if(aBox) aBox.scrollTop=aPrevNear?aBox.scrollHeight:aPrevTop;
      renderNodeModal();
      return;
    }
    var counts=stageCounts(); var cur=latestStage(); var curIdx=stageIdx(cur);
    var evf=filterEventRows(state.detailEvents,state.hideToolEvents===true);   // UI-10
    var eventHtml=evf.rows.length?evf.rows.map(function(e){
      return '<div class="ev-row '+esc(e.kind)+'"><span class="ev-idx">#'+e.idx+'</span><span class="ev-ts">'+esc(fmtTime(e.t))+'</span><span class="ev-stage">'+esc(isDeterministicRun(run)?detEventStage(e.msg):stageLabel(e.stage))+'</span><span class="ev-msg">'+esc(stripWorkspacePath(e.msg))+'</span></div>';
    }).join(''):'<div class="ev-empty">'+(evf.hidden?(evf.hidden+' tool call'+(evf.hidden===1?'':'s')+' hidden'):'waiting for event replay…')+'</div>';
    var streamLabel=run.status==='running'?(state.detailStream?'● live':'● tailing'):run.status==='complete'?'✓ complete':run.status;
    var brief=String(run.brief||'').trim(); var briefLong=brief.length>240;
    // Deck hero folds the run brief into the header card (was a standalone rd-brief card); keep the
    // clamp + Show more/less affordance (toggle-brief).
    var heroBrief=brief?'<p class="scan-hero-brief'+(briefLong&&!state.briefOpen?' clamp':'')+'">'+esc(brief)+'</p>'+(briefLong?'<button class="scan-hero-more" data-act="toggle-brief">'+(state.briefOpen?'Show less':'Show more')+'</button>':''):'';
    var eventCard='<div class="rd-card flush"><div class="rd-sec-head"><h3>Event stream</h3><span class="ev-head-r">'+eventFilterChip(state.hideToolEvents===true,evf.hidden)+'<span class="eyebrow">'+esc(streamLabel)+'</span></span></div><div class="ev-stream" id="runEventStream">'+eventHtml+'</div></div>';
    var cks=ckListOf(run); var lastCk=cks.length?cks[cks.length-1]:null;
    // checkpoint/resume affordances — ONE consistent resume button (↻): honey + alone (the primary action) on a
    // failed/stopped run, ghost beside "Open report →" on a complete run (deck's hero action row).
    var resumable=ckResumable(run);
    var resumeBtn=resumable&&run.status!=='running'?'<button class="btn '+(run.status==='complete'?'ghost':'honey')+'" data-act="open-resume" data-id="'+esc(run.id)+'">↻ Resume from checkpoint</button>':'';
    var openBtn=run.status==='complete'?'<button class="btn honey openrep" data-id="'+esc(run.id)+'">Open report →</button>':'';
    // A QUEUED run (parked behind another heavy run) is cancellable too — the /stop route cancels it (marks it
    // stopped). Label it "Cancel" vs "Stop" for a live run.
    var stopBtn=run.status==='running'?'<button class="btn ghost" data-act="stop-run" data-id="'+esc(run.id)+'">Stop</button>'
      :run.status==='queued'?'<button class="btn ghost" data-act="stop-run" data-id="'+esc(run.id)+'">Cancel</button>':'';
    var ckline='';
    if(resumable&&(run.status==='error'||run.status==='stopped')&&lastCk) ckline='<div class="rd-ckline">◆ last checkpoint: '+esc(lastCk.label)+' · saved '+esc(relTime(lastCk.at))+' — resume re-runs only what’s after it</div>';
    else if(resumable&&run.status==='complete') ckline='<div class="rd-ckline">◆ '+cks.length+' checkpoint'+(cks.length===1?'':'s')+' · resume from any of them to re-run later stages with the same inputs</div>';
    var parentRun=run.resumedFrom?runById(run.resumedFrom.runId):null;
    var lineage=run.resumedFrom?' <span class="lineage-chip" data-act="goto-run" data-id="'+esc(run.resumedFrom.runId)+'" title="open the parent run">↻ from '+esc(parentRun?(parentRun.alias||parentRun.id):run.resumedFrom.runId)+' @ '+esc(run.resumedFrom.checkpoint)+'</span>':'';
    var childRun=run.supersededBy?runById(run.supersededBy):null;
    var superseded=run.supersededBy?' <span class="lineage-chip" data-act="goto-run" data-id="'+esc(run.supersededBy)+'" title="Replaced by a resumed child run — open it for the newer results">superseded by '+esc(childRun?(childRun.alias||childRun.id):run.supersededBy)+' →</span>':'';
    // Deck HERO card — scope eyebrow · big title + status/lineage · brief · sources + checkpoint lines, a big
    // findings numeral on the right, then the action row (Open report / Resume / est. cost). Replaces the old
    // id-header + 4-up metric cells. "areas" = the count of per-bundle AREA reports the run really produced.
    var nAreas=(run.bundleReports||[]).length;
    var nFind=Number(run.findings)||0;
    // Ruled-out hypotheses are carried apart from findings — show them as a muted count, never in the numeral.
    var nRuledOut=Array.isArray(run.ruledOut)?run.ruledOut.length:(typeof run.ruledOut==='number'?run.ruledOut:0);
    var heroNum='<div class="scan-hero-side"><div class="scan-hero-num">'+esc(String(nFind))+'</div><div class="scan-hero-numlbl">'+(nFind===1?'finding':'findings')+(nAreas?' · '+esc(plural(nAreas,'area')):'')+(nRuledOut?' · '+esc(String(nRuledOut))+' ruled out':'')+'</div></div>';
    // Live spend while running (against the per-run cap), the ACTUAL cost once terminal.
    var sp=spendInfo(run,(state.effectiveRunBudget===0)?null:state.runBudget);
    var heroCost='<span class="scan-hero-cost">'+esc(sp.label)+' <b>'+esc(sp.value)+'</b>'+(sp.cap?' / '+esc(sp.cap):'')+(sp.overPct>0?' · <span style="color:#B3401F">over cap by '+sp.overPct+'%</span>':'')+(run.reusedCostUsd!=null?' · +'+esc(money(run.reusedCostUsd))+' reused from parent':'')+'</span>';
    var scopeSub=String(run.scope||run.scopeLabel||'').trim();   // The Scope label, as the title's subtitle
    // Every stage that degraded (fail-open, no longer silent) + the boot OpenAI auth probe → one warning banner.
    var dRows=degradedRows(run,state.openaiAuthOk);
    var degradedBanner=degradedBannerHtml(dRows);   // one banner renderer for Full Scan + Quick Ask (plain stage names, no env-var names)
    var hero='<div class="rd-card">'
      +'<div class="scan-hero-row"><div class="scan-hero-main">'
        +'<div class="scan-hero-eyebrow">'+esc(run.alias||(run.kind==='audit'?'Rec audit':'Full Scan'))+' <button type="button" class="rd-rename" data-act="rename-run" data-id="'+esc(run.id)+'" aria-label="Rename" title="Rename this run">✎</button></div>'
        +'<div class="scan-hero-titlerow"><h2 class="scan-hero-title">'+esc(runTitle(run))+'</h2>'+statusBadge(run.status)+lineage+superseded+'</div>'

        +(scopeSub?'<p class="scan-hero-scope">'+esc(scopeSub)+'</p>':'')
        +heroBrief
        +'<p class="scan-hero-line">'+esc(run.mode)+' run across '+esc(fixCountPlurals(run.targetName||'selected artifacts'))+(run.error?' · '+esc(run.error):'')+'</p>'+ckline+incrHtml(run,3)
      +'</div>'+heroNum+'</div>'
      +'<div class="scan-hero-acts">'+stopBtn+openBtn+resumeBtn+heroCost+'</div>'
    +'</div>'
    +degradedBanner;
    // Visualization row (deck: Code intelligence + Design & evolution). DATA-HONESTY: render a card ONLY when the
    // run really produced that artifact — no fabricated SVG/figures. Code-intel is gated on a real codeintel /
    // cross-repo signal on the run (its viz lives inside the reports, so the card links there); Design & evolution
    // is gated on run.provenance (the standalone doc-recovery report). Neither present → the whole row is omitted.
    var vizCards=[];
    if(run.codeintel&&run.mode==='agentic'){   // a deterministic run never mounts the plane (older records stored the bare toggle)
      // The copy follows whether a report ACTUALLY carries the maps (codeintelCardCopy), not just the toggle.
      var ci=codeintelCardCopy(run);
      var ciOpen=(!ci.link||run.status!=='complete')?'':'<button class="btn ghost" data-rk="internal" data-id="'+esc(run.id)+'">Open '+esc(internalReportLabel(run).toLowerCase())+' →</button>';
      vizCards.push('<div class="scan-viz-card"><div class="scan-viz-head"><span class="scan-viz-eyebrow">Code intelligence</span><span class="scan-viz-tag">'+esc(ci.tag)+'</span></div><div class="scan-viz-body">'+esc(ci.body)+'</div>'+ciOpen+'</div>');
    }
    // Two-report model: the git-history spine now lives in the Execution report's Appendix — no separate card / entry.
    var vizRow=vizCards.length?('<div class="scan-viz-row" style="grid-template-columns:'+(vizCards.length===1?'minmax(0,1fr)':'minmax(0,1fr) minmax(0,1fr)')+'">'+vizCards.join('')+'</div>'):'';
    // Reusable method learned (deck) — wired to run.learned (pattern + signature chips + merge counts). Rendered
    // only when the run recorded a learned method; else omitted (no fabrication).
    var lm=run.learned;
    var learnedCard='';
    if(lm&&lm.pattern){
      var lsig=(lm.signature&&lm.signature.length)?lm.signature:(lm.checks||[]);
      var lchips=lsig.map(function(s){ return '<span class="scan-sig">'+esc(s)+'</span>'; }).join('');
      var lsv=lm.saved||{}; var laddN=lsv.added||0, lupdN=lsv.updated||0, ltotN=lsv.total||0;
      learnedCard='<div class="scan-learned">'
        +'<div class="scan-learned-head"><span class="scan-learned-glyph">✦</span><span class="scan-learned-title">Reusable method learned</span><span class="scan-learned-tag" title="value-free: the method only — no project numbers or conclusions">reusable</span></div>'
        +'<div class="scan-learned-body">'
          +'<div class="scan-learned-pattern">'+esc(lm.pattern)+'</div>'
          +(lchips?'<div class="scan-learned-chips">'+lchips+'</div>':'')
          +'<div class="scan-learned-foot"><span class="scan-learned-count">'+((laddN||lupdN||ltotN)?('+<b>'+laddN+'</b> new · <b>'+lupdN+'</b> reinforced · <b>'+ltotN+'</b> in memory'):'Not saved to memory — this run did not write memory')+'</span><button class="btn ghost" data-go="memory">Open Memory →</button></div>'
        +'</div></div>';
    }
    // Run output as a chip grid (deck) — one chip per REAL artifact, each carrying its EXISTING open/export action
    // (openrep/opencombined/openlead/openbundle classes, provenance/trace/audit hrefs, export-md).
    var outputCard='';
    if(run.status==='complete'){
      // "Start here": reportGuide (READING_HELPERS_JS) picks ONE recommended entry (Leadership > Combined >
      // Detailed) and orders the rest; every entry carries its audience + read-time line and its existing action.
      var guide=reportGuide(run); var rec=guide[0]&&guide[0].recommended?guide[0]:null; var rest=rec?guide.slice(1):guide;
      var recHtml=rec?('<'+guideTag(rec)+' class="scan-guide-rec" '+guideOpenAttr(run,rec)+'><span class="sg-tag">Start here</span><span><span class="sg-nm">'+esc(rec.label)+'</span><br><span class="sg-ln">'+esc(rec.line)+'</span></span><span class="sg-go">Open &rarr;</span></'+guideTag(rec)+'>'):'';
      var chips=rest.map(function(e){ return '<'+guideTag(e)+' class="scan-chip" '+guideOpenAttr(run,e)+' title="'+esc(e.label+' — '+e.line)+'">'+esc(e.label)+'<span class="sc-ln">'+esc(e.line)+'</span></'+guideTag(e)+'>'; });
      // Two-report model: a Full Scan's trace / audit are debugging records, not reports — one muted line here only.
      var opsHtml=(isFullScanRun(run)&&(run.hasTrace||run.hasAudit))
        ? '<div class="scan-out-ops" style="margin-top:10px;font-size:13px;color:var(--muted)">Debugging · '
          +[run.hasTrace?'<a href="/api/runs/'+encodeURIComponent(run.id)+'/trace" target="_blank" rel="noopener" style="color:inherit">run trace</a>':'',
            run.hasAudit?'<a href="/api/runs/'+encodeURIComponent(run.id)+'/audit" target="_blank" rel="noopener" style="color:inherit">run audit</a>':''].filter(Boolean).join(' · ')+'</div>'
        : '';
      outputCard='<div class="scan-out"><div class="scan-out-head"><span class="scan-out-eyebrow">Run output</span><span class="scan-out-count">'+guide.length+(isFullScanRun(run)?' report':' artifact')+(guide.length===1?'':'s')+'</span></div>'+recHtml+(chips.length?'<div class="scan-out-grid">'+chips.join('')+'</div>':'')+opsHtml+'</div>';
    }
    var html='<div class="rd-stack">'
      +hero
      +'<div class="rd-grid run-balance-grid">'
        +'<div class="rd-card flush run-pipeline-card"><div class="rd-sec-head"><h3>Pipeline graph</h3><span class="eyebrow" style="color:var(--honey-link)">'+(cks.length?'◆ = durable checkpoint':'node per agent')+'</span></div>'
          +'<div class="tl run-pipeline-body">'+timelineHtml(run,counts,curIdx)+'</div></div>'
        +'<div class="rd-col run-side-col">'+eventCard+checkpointsCard(run)+'</div>'
      +'</div>'
      +vizRow
      +learnedCard
      +outputCard
      // Post-run Memory surface (full-scan detail): only when this run had the "Save learnings to memory" tick set.

      // Reuses the ask detail's renderAskMemoryAdds — lazy-fetches /api/memory/history?run_id=<id> and lists what the
      // finishRun memory-draft hook added ("✦ this run added N memory update(s)" + link to Memory). Fail-open.
      +((run.status==='complete'&&run.writeMemory===true)?renderAskMemoryAdds(run):'')
      +'</div>';
    // Preserve the event-stream scroll across the full host rebuild: only auto-scroll to the bottom if the
    // user was already near the bottom (tailing); otherwise restore their position so a live event doesn't
    // yank the view while they're reading higher up.
    var oldBox=document.getElementById('runEventStream');
    var prevTop=oldBox?oldBox.scrollTop:0;
    var prevNear=oldBox?(oldBox.scrollHeight-oldBox.scrollTop-oldBox.clientHeight<60):true;
    host.innerHTML=html;
    var box=document.getElementById('runEventStream'); if(box) box.scrollTop = prevNear ? box.scrollHeight : prevTop;
    syncRunDetailHeights();
    renderNodeModal(); // sig-guarded: a no-op unless the SELECTION changed, so reveal ticks never rebuild it
  }
  function syncRunDetailHeights(){
    if(state._runBalanceRaf) return;
    state._runBalanceRaf=requestAnimationFrame(function(){
      state._runBalanceRaf=null;
      var grid=document.querySelector('#runDetail .run-balance-grid');
      if(!grid) return;
      var card=grid.querySelector('.run-pipeline-card');
      var body=grid.querySelector('.run-pipeline-body');
      var side=grid.querySelector('.run-side-col');
      if(!card||!body||!side) return;
      card.style.height='';
      card.classList.remove('compact');
      if(window.matchMedia&&window.matchMedia('(max-width: 1100px)').matches) return;
      var h=Math.ceil(side.getBoundingClientRect().height);
      if(!h) return;
      card.style.height=Math.max(360,h)+'px';
      if(body.scrollHeight>body.clientHeight+6) card.classList.add('compact');
    });
  }
  window.addEventListener('resize',syncRunDetailHeights);
  // Throttle live re-renders. A running run can burst many SSE events; rebuilding the whole detail card
  // (graph + cards + event stream) per event is what makes it "jitter". Coalesce to at most one rebuild
  // every ~450ms — fast enough to feel live, slow enough not to shake.
  function scheduleDetailRender(){
    if(state._detailRenderPending) return;
    state._detailRenderPending=true;
    var since=(state._lastDetailRenderAt!=null)?(Date.now()-state._lastDetailRenderAt):1e9;
    var wait=Math.max(0, 450-since);
    setTimeout(function(){ state._detailRenderPending=false; state._lastDetailRenderAt=Date.now(); renderRunList(); renderRunDetail(); renderAskRunDetail(); renderTopbar(currentView()); }, wait);   // ask-tab detail shares the stream buffer — keep it live too
  }
  // /api/state is not re-polled during a live run, so the run's costUsd (updated incrementally by the
  // server-side ledger) never reached the hero ("spent so far —"). Poll GET /api/runs/:id at most every 5s — on stream
  // events and on a slow timer (a long agent call can be quiet) — and re-render when the figure moved.
  function pollLiveSpend(id){
    var now=Date.now(); if(!liveSpendDue(state._spendPollAt,now,5000)) return;
    var run=runById(id); if(!run||(run.status!=='running'&&run.status!=='queued')) return;
    state._spendPollAt=now;
    api('/api/runs/'+encodeURIComponent(id)).then(function(r){ return r.json(); }).then(function(d){
      var cur=runById(id); if(cur&&mergeLiveSpend(cur,d)) scheduleDetailRender();
    }).catch(function(){});
  }
  setInterval(function(){ var r=activeRun(); if(r&&r.status==='running'&&state.detailStreamId===r.id) pollLiveSpend(r.id); },15000);
  function attachDetailStream(id){
    var run=runById(id); if(!run) return;
    var need=state.detailLoadedId!==id || (run.status==='running' && !state.detailStream);
    if(!need) return;
    if(state.detailStream){ try{state.detailStream.close();}catch(_){} }
    state.detailStream=null; state.detailStreamId=id; state.detailLoadedId=id; state.detailEvents=[]; state.detailStageNow=null; state.detailStageByBundle=null; state.detailBundles=null; state.detailCached=null;
    renderRunDetail();
    var es=new EventSource('/api/runs/'+encodeURIComponent(id)+'/events');
    state.detailStream=es;
    es.addEventListener('log',function(e){
      if(state.activeRunId!==id) return;
      var ts=e.lastEventId?Number(e.lastEventId):null;   // backend carries the per-line epoch-ms in the SSE id: field
      var ev=parseRunEvent(e.data,state.detailEvents.length,ts);
      state.detailEvents.push(ev);
      if(!state.stagePinned) state.detailStage=ev.stage;
      scheduleDetailRender();
      pollLiveSpend(id);   // The hero's "spent so far" follows run.costUsd while the run is live
    });
    es.addEventListener('done',function(e){
      var d={}; try{ d=JSON.parse(e.data||'{}'); }catch(_){}
      if(state.activeRunId===id){
        if(d.stopped){ run.status='stopped'; state.detailEvents.push(parseRunEvent('stopped by user',state.detailEvents.length,lastEventTime(state.detailEvents))); }
        else {
          run.findings=d.findings!=null?d.findings:run.findings; run.costUsd=d.costUsd!=null?d.costUsd:run.costUsd;
          // An ask produces an ANSWER, not findings — never print "0 findings" for it; plural-correct otherwise.
          state.detailEvents.push(parseRunEvent('done · '+(run.kind==='ask'?'answer ready':plural(run.findings||0,'finding'))+(run.costUsd!=null?' · '+money(run.costUsd):''),state.detailEvents.length,lastEventTime(state.detailEvents)));
          run.status='complete'; if(!state.stagePinned) state.detailStage='report';
        }
      }
      try{es.close();}catch(_){} if(state.detailStream===es) state.detailStream=null;
      scheduleDetailRender(); setTimeout(loadState,250);
    });
    // A QUEUED run has no worker yet — the server emits a single 'queued' event and CLOSES the stream. Handle it
    // BEFORE the close can trip the 'error' handler below (we close ourselves here, like the 'done' path, so no
    // reconnect + no false error): reflect 'queued' and poll until the promoter starts it, then re-attach.
    es.addEventListener('queued',function(e){
      try{es.close();}catch(_){} if(state.detailStream===es) state.detailStream=null;
      if(state.activeRunId===id && run) run.status='queued';
      scheduleDetailRender();
      waitForPromotion(id);
    });
    es.addEventListener('error',function(e){
      if(state.activeRunId===id){
        run.status='error'; try{ if(e.data) run.error=JSON.parse(e.data).error||run.error; }catch(_){}
        state.detailEvents.push(parseRunEvent('error: '+(run.error||'stream error'),state.detailEvents.length,lastEventTime(state.detailEvents)));
        if(!state.stagePinned) state.detailStage=state.detailEvents[state.detailEvents.length-1].stage;
      }
      try{es.close();}catch(_){} if(state.detailStream===es) state.detailStream=null;
      scheduleDetailRender(); setTimeout(loadState,250);
    });
  }
  function selectRunDetail(id,push){
    var r=runById(id); if(!r) return;
    state.activeRunId=id; state.configOpen=false; state.briefOpen=false; state.stagePinned=false; state.detailStage='comprehend'; state.artifactKind='all'; state.artifactIndex=0;
    state.selNode=null; state.selBundle=null; state.modalOpen=false;   // nothing selected → modal closed; user clicks a node to open it
    if(state.resumeOpen){ state.resumeOpen=null; state.resumeError=''; }   // selecting a run (same one included) exits the resume pane back to run detail; open-resume re-sets it after
    if(push && currentView()==='run') history.replaceState(null,'','/run?run='+encodeURIComponent(id));
    attachDetailStream(id);
    renderRunList(); renderRunDetail(); renderNodeModal();
    renderTopbar(currentView());   // swap the topbar run bar NOW — waiting for the next loadState round-trip made it lag seconds behind the click
  }
  function renderRuns(runs){
    state.runs=runs||[];
    var urlRun=runFromUrl();
    if(urlRun && runById(urlRun)){ state.activeRunId=urlRun; state.configOpen=false; }
    else if(currentView()==='run') resetRunLanding();
    else if(!state.activeRunId || !runById(state.activeRunId)){ var _scans=state.runs.filter(function(r){return r.kind!=='ask'&&r.kind!=='design';}); state.activeRunId=_scans.length?_scans[0].id:(state.runs.length?state.runs[0].id:null); }   // Full Scan detail defaults to the newest SCAN (asks live in their own tab; legacy Design Doc runs are report-library only)
    renderRunList(); renderRunDetail(); renderAskRunList(); renderAskRunDetail();
    if(state.activeRunId) attachDetailStream(state.activeRunId);
  }

  // Parse the "Data MCPs" textarea into [{name,mcpUrl,mcpToken}]. Accepts EITHER the standard MCP config JSON (the
  // mcpServers block you would paste from a Claude Code session / .mcp.json) OR one "name URL [token]" per line.
  function parseMcps(text){
    text=(text||'').trim(); if(!text) return [];
    try {
      var j=JSON.parse(text); var map=(j&&j.mcpServers)?j.mcpServers:j; var out=[];
      if(map&&typeof map==='object'){ Object.keys(map).forEach(function(name){
        var s=map[name]||{}; if(typeof s==='string'){ out.push({name:name,mcpUrl:s,mcpToken:''}); return; }
        var url=s.url||s.endpoint||s.href||''; var tok=s.token||'';
        if(!tok&&s.headers){ var a=s.headers.Authorization||s.headers.authorization||''; tok=String(a).replace(/^Bearer\s+/i,''); }
        if(url) out.push({name:name,mcpUrl:String(url),mcpToken:String(tok)});
      }); if(out.length) return out; }
    } catch(e){ /* not JSON — fall through to line format */ }
    return text.split('\n').map(function(l){return l.trim();}).filter(Boolean).filter(function(l){return l[0]!=='#';}).map(function(l){
      var p=l.split(/\s+/); var name=p[0]||'',url=p[1]||'',tok=p[2]||'';
      if(/^https?:\/\//.test(name)&&!url){ url=name; name=''; }     // a bare URL with no name
      return {name:name,mcpUrl:url,mcpToken:tok};
    }).filter(function(m){return m.mcpUrl;});
  }
  // Pre-fill the textarea from the currently-connected MCPs as the standard mcpServers JSON, so editing round-trips.
  function fillMcpList(){
    var el=document.getElementById('mcpList'); if(!el) return;
    var mcps=(state.sources||[]).filter(function(s){return s.kind==='analytics'||s.kind==='bi'||s.kind==='custom';});
    if(!mcps.length){ el.value=''; return; }
    var obj={mcpServers:{}}; mcps.forEach(function(s){ obj.mcpServers[s.mcpName||s.name]={type:'http',url:s.mcpUrl||''}; });
    el.value=JSON.stringify(obj,null,2);
  }

  function snapshotConnectionFields(kind){
    var snap={};
    (CONNECT_CLEAR_FIELDS[kind]||[]).forEach(function(id){ var el=document.getElementById(id); if(el)snap[id]=el.value; });
    return snap;
  }
  function clearSubmittedConnectionFields(kind,snap){
    if(state.pick!==kind)return;
    (CONNECT_CLEAR_FIELDS[kind]||[]).forEach(function(id){
      var el=document.getElementById(id); if(!el)return;
      if(Object.prototype.hasOwnProperty.call(snap,id)&&el.value===snap[id])el.value='';
    });
  }

  // ---------- add a connection ----------
  function addConnection(){
    var kind=state.pick; var body={kind:kind}; var msg=document.getElementById('connectMsg');
    if(kind==='warehouse'){
      // BigQuery: a service-account key JSON (read-only roles) OR a warehouse MCP URL (+ optional token).
      var sj=document.getElementById('whSaJson'); var saJson=sj?sj.value.trim():'';
      if(saJson) body.saJson=saJson;
      else { body.mcpUrl=document.getElementById('whUrl').value.trim(); body.mcpToken=document.getElementById('whToken').value.trim(); }
      if(!saJson&&!body.mcpUrl){ msg.textContent='Paste a BigQuery service-account key JSON, or an MCP URL.'; return; }
    }
    else if(kind==='keyvalue'){ body.mcpUrl=document.getElementById('kvUrl').value.trim(); body.mcpToken=document.getElementById('kvToken').value.trim(); }
    else if(kind==='github'){ var tk=document.getElementById('ghToken'); body.token=tk?tk.value.trim():''; }
    else if(kind==='local'){ var lp=document.getElementById('localPath'); body.path=lp?lp.value.trim():''; }
    else if(kind==='giturl'){ var gu=document.getElementById('giturlUrls'); body.urls=gu?gu.value:''; }
    else if(kind==='mcp'){ var ml=document.getElementById('mcpList'); var set=parseMcps(ml?ml.value:''); if(!set.length){msg.textContent='Paste at least one MCP (JSON or a name + URL line).';return;} body={kind:'mcp-set',mcps:set}; }
    var clearSnap=snapshotConnectionFields(kind);
    msg.textContent='Validating…';
    api('/api/sources',{method:'POST',body:body}).then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});}).then(function(res){
      if(res.ok){
        if(kind==='mcp' && typeof res.d.count==='number'){ var drp=res.d.dropped||[]; msg.textContent=res.d.count+' MCP'+(res.d.count===1?'':'s')+' connected'+(drp.length?(' · '+drp.length+' duplicate name'+(drp.length===1?'':'s')+' merged ('+drp.join(', ')+') — give them distinct names'):' ✓'); }
        else if(kind==='giturl'){ var rej=res.d.rejected||[]; var ad=res.d.added||0; msg.textContent=ad+' public repo'+(ad===1?'':'s')+' added ✓'+(res.d.capped?' · cap reached (max 20)':'')+(rej.length?(' · '+rej.length+' rejected (only public github.com URLs): '+rej.slice(0,3).join(', ')):''); }
        else { msg.textContent='connected ✓'; }
        // Clear only the acted source's unchanged fields. This keeps another source's in-progress typing intact
        // if you switch panels while this validation request is in flight.
        clearSubmittedConnectionFields(kind,clearSnap);
        // Repaint the open detail side AFTER state refreshes: loadState() updates the source CARDS but NOT the
        // selected-source panel (connected list + Disconnect button), so a just-connected source otherwise
        // shows no "Connected …" list / no Disconnect until reopen.
        // Repaint the open detail (connected list + Disconnect button) only if still on the acted source
        // (don't clobber a textarea the user moved to meanwhile). SKIP kind==='mcp': its selectSource runs
        // fillMcpList(), which would replace the deliberately-not-cleared mcpList (incl. the just-pasted
        // bearer token) with the token-less /api/state projection.
        loadState().then(function(){ if(state.pick===kind && kind!=='mcp')selectSource(kind); }); }
      else msg.textContent=res.d.error||'Could not connect.';
    }).catch(function(){msg.textContent='Network error.';});
  }

  // ---------- run ----------
  // Incremental re-scan — the artifacts map POST /api/runs takes, and the baseline preview for it (GET /api/scan-baseline,
  // debounced; only the #cfgBaseline line is repainted, so typing in the brief never loses focus).
  function currentArtSel(){ var sel={}; state.sources.forEach(function(s){ (s.artifacts||[]).forEach(function(a){ var k=s.id+'::'+a.id; if(state.artSel[k]!==false){ (sel[s.id]=sel[s.id]||[]).push(a.id); } }); }); return sel; }
  function baselineHtml(){
    var bl=baselineLine(state.baselineInfo,state.fullRescan===true);
    if(!bl.show) return '';
    var cb=bl.canFullRescan?'<span class="cfg-full" data-act="full-rescan" role="checkbox" tabindex="0" aria-checked="'+(state.fullRescan?'true':'false')+'" title="Re-scan everything from scratch instead of reusing what did not change (the comparison with the baseline is still reported)"><span class="cbx'+(state.fullRescan?' on':'')+'" aria-hidden="true"></span>Full rescan</span>':'';
    return '<div class="cfg-baseline">'+esc(bl.text)+cb+'</div>';
  }
  function paintBaseline(){ var el=document.getElementById('cfgBaseline'); if(el) el.innerHTML=baselineHtml(); }
  var baselineTimer=null;
  // The preview also takes what the planner compares — the brief, the memory-recall and codeintel
  // ticks and a manual bundle pick — so a change there reads "full scan — <reason>" instead of a $0.22 promise.
  function baselineQuery(){
    var bt=document.getElementById('engagementBrief'); var brief=bt?bt.value:(state.briefText||'');
    var bundles=state.overrideBundles?BUNDLES.filter(function(b){return state.bundleSel[b.key]===true;}).map(function(b){return b.key;}):[];
    return { brief:String(brief||'').trim().slice(0,8000), memoryRecall:state.memRecall===true?'1':'0', codeintel:state.orgCodeintel===false?'0':'1', bundles:bundles.join(',') };
  }
  function ensureBaselineInfo(){
    var sel=currentArtSel(); var q=baselineQuery(); var selSig=JSON.stringify(sel); var sig=JSON.stringify([sel,q]);
    if(sig===state.baselineSig) return;
    state.baselineSig=sig;
    if(selSig==='{}'){ state.baselineInfo=null; return; }
    state.baselineInfo={loading:true};
    if(baselineTimer) clearTimeout(baselineTimer);
    baselineTimer=setTimeout(function(){
      var qs='sel='+encodeURIComponent(selSig)+'&brief='+encodeURIComponent(q.brief)+'&memoryRecall='+q.memoryRecall+'&codeintel='+q.codeintel+(q.bundles?'&bundles='+encodeURIComponent(q.bundles):'');
      api('/api/scan-baseline?'+qs).then(function(r){ return r.json(); }).then(function(d){
        if(state.baselineSig!==sig) return; state.baselineInfo=d||null; paintBaseline();
      }).catch(function(){ if(state.baselineSig!==sig) return; state.baselineInfo={error:'network'}; paintBaseline(); });
    },400);
  }
  function startRun(confirmed){
    var sel={}; var any=false;
    state.sources.forEach(function(s){ (s.artifacts||[]).forEach(function(a){ var k=s.id+'::'+a.id; if(state.artSel[k]!==false){ (sel[s.id]=sel[s.id]||[]).push(a.id); any=true; } }); });
    if(!any) return;
    if(needsClaudeToken()) return; // no Anthropic key yet (Settings) — the server refuses too

    var bt=document.getElementById('engagementBrief'); if(bt) state.briefText=bt.value;
    var sc0=document.getElementById('cfgScope'); if(sc0) state.scopeText=sc0.value;
    // A wide (>5 repos) or live-data (any plane) run needs the explicit confirm step first. The summary +
    // needsConfirm come from the same scanSummary the form renders (renderRunConfig recomputes them).
    var pc=planeChoices(state.sources);
    var planeFilter=pc.planes.filter(function(p){ return state.planeSel[p.id]===true; }).map(function(p){ return p.id; });
    var nRepoSel=0; state.sources.forEach(function(s){ if(s.kind==='github'||s.kind==='giturl') nRepoSel+=(sel[s.id]||[]).length; });
    if(!confirmed && scanSummary({ repos:nRepoSel, planes:planeFilter.length }).needsConfirm){ state.scanConfirm=true; renderRunDetail(); return; }
    state.scanConfirm=false;
    var btn=document.getElementById('startBtn'); if(btn){btn.disabled=true;btn.textContent='Starting…';}
    var invs=(window.__INV__||[]).filter(function(i){return state.invSel[i.key]!==false;}).map(function(i){return i.key;});
    // Only an explicit "Override Comprehend" sends a manual bundle set; otherwise send [] (auto — Comprehend selects).
    var bundleSel=state.overrideBundles?BUNDLES.filter(function(b){return state.bundleSel[b.key]===true;}).map(function(b){return b.key;}):[];
    var memoryRecall=(state.memRecall===true);    // The visible "Recall memory" toggle (default OFF)
    var writeMem=(state.orgWriteMemory===true);
    var codeintel=(state.orgCodeintel!==false);   // read from SPA state (survives config re-renders); default ON
    var docRec=false;   // two-report model: the stand-alone Design & evolution report is gone (a remembered old tick is ignored)
    // planeFilter / memoryRecall: the plane-selection request contract (src/run/planeSelection.ts) — the server mounts
    // ONLY these. scopeLabel: the Scope label, shown as the run title's subtitle.
    api('/api/runs',{method:'POST',body:{artifacts:sel,brief:state.briefText||'',scopeLabel:String(state.scopeText||'').trim()||undefined,invariants:invs,bundles:bundleSel,planeFilter:planeFilter,memoryRecall:memoryRecall,siblingRecall:(state.siblingRecall===true),writeMemory:writeMem,codeintel:codeintel,docRecovery:docRec,fullRescan:(state.fullRescan===true)||undefined}}).then(function(r){return r.json().then(function(d){return{ok:r.ok,status:r.status,d:d};});}).then(function(res){
      if(!res.ok){ state.runError=res.d.error||'Failed to start run.'; if(res.status===428||/key/i.test(state.runError)) loadSettings(); renderRunDetail(); return; }
      rememberScanSel();   // Your last selection pre-fills the next New Full Scan
      state.scopeText='';
      state.fullRescan=false; state.baselineSig='';   // incremental re-scan: the next New Full Scan starts unticked + re-previews
      state.siblingRecall=false;   // cross-project memory: the opt-in is per run — the next New Full Scan starts unticked
      state.configOpen=false; state.briefText=''; state.bundleSel={}; state.runError=''; state.activeRunId=res.d.id; state.detailLoadedId=null; state.detailEvents=[]; state.detailStageNow=null; state.detailStageByBundle=null; state.detailBundles=null; state.stagePinned=false;
      if(currentView()==='run') history.replaceState(null,'','/run?run='+encodeURIComponent(res.d.id));
      loadState();
    }).catch(function(){ state.runError='Network error — could not start the run.'; renderRunDetail(); });
  }
  // The element + action for one reportGuide entry: reading-room kinds open via report-open-art (the same
  // action the library cards use), REMEDIATION.md exports, trace / audit open in a new tab.
  function guideTag(e){ return (e.kind==='trace'||e.kind==='audit')?'a':'button'; }
  function guideOpenAttr(run,e){
    var id=esc(run.id);
    if(e.kind==='remediation') return 'data-act="export-md" data-id="'+id+'"';
    if(e.kind==='trace'||e.kind==='audit') return 'href="/api/runs/'+encodeURIComponent(run.id)+'/'+e.kind+'" target="_blank" rel="noopener"';
    return 'data-act="report-open-art" data-id="'+id+'" data-artkind="'+esc(e.kind)+'"'+(e.kind==='bundle'?' data-bundle="'+esc(e.bundleId)+'"':'');
  }
  function downloadMd(md,name){
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([md],{type:'text/markdown'})); a.download=name;
    document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},800);
  }
  // Client-side REMEDIATION.md export. For an accel-mini ASK run the remediation IS the dedicated Work-items
  // report → export its embedded structured items as an item→location→context checklist. For an audit/org run
  // it's the report's embedded findings. Both rebuilt client-side from the embedded JSON (no API change).
  function exportRemediation(id){
    id=id||state.activeRunId; var run=runById(id); if(!run||run.status!=='complete') return;
    if(run.kind==='ask'){
      if(!run.workItems){ downloadMd('# Remediation — '+runTitle(run)+'\n\n_No engineering work items — this question asked to understand, not to fix. Re-ask with "Include an engineering work-item list" to get a remediation checklist._\n','quick-ask-'+id+'-REMEDIATION.md'); return; }
      api('/api/runs/'+encodeURIComponent(id)+'/workitems').then(function(r){if(!r.ok)throw 0;return r.text();}).then(function(html){
        var items=null; var m=html.match(/__ACCEL_WORKITEMS__\s*=\s*(\[[\s\S]*?\])\s*;?\s*<\/script>/);
        try{ items=m?JSON.parse(m[1]):null; }catch(_){ items=null; }
        var md='# Remediation — '+runTitle(run)+'\n\n_Quick Ask · '+((items&&items.length)||0)+' engineering work items · read-only'+(run.costUsd!=null?(' · '+money(run.costUsd)):'')+'_\n\n';
        if(!items||!items.length){ md+='Open the **Work items** report tab for the full checklist — items were not embeddable for export.\n'; }
        else items.forEach(function(w,i){
          md+='## '+(i+1)+'. '+(w.title||'Work item')+(w.effort?(' _('+w.effort+')_'):'')+'\n\n';
          if(w.files&&w.files.length) md+='**Location:** '+w.files.join(' · ')+'\n\n';
          if(w.detail) md+='**Context:** '+w.detail+'\n\n';
        });
        downloadMd(md,'quick-ask-'+id+'-REMEDIATION.md');
      }).catch(function(){});
      return;
    }
    api('/api/runs/'+encodeURIComponent(id)+'/report').then(function(r){if(!r.ok)throw 0;return r.text();}).then(function(html){
      var data=null; var m=html.match(/__ACCEL_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
      try{ data=m?JSON.parse(m[1]):null; }catch(_){ data=null; }
      // remediationMarkdown (shared, reportHtml.ts REMEDIATION_MD_JS) lists CONFIRMED findings only — ruled-out rows
      // go under "Ruled out (no action)" — so the item count matches run.findings, not the raw embedded row count.
      var md=remediationMarkdown({ title: runTitle(run), findings: (data&&data.findings)||[], before: (run.mode||'')+' run · ', after: (run.costUsd!=null?(' · '+money(run.costUsd)):''), emptyNote: 'Open the interactive report for the full diagnosis — findings were not embeddable for export.' });
      downloadMd(md,id+'-REMEDIATION.md');
    }).catch(function(){});
  }
  // Two reports per run: the detailed INTERNAL report (/report) and the LEADERSHIP report (/leadership, agentic
  // runs only). One iframe; a toggle bar above it swaps which is shown.
  function showReportFrame(){ var l=document.getElementById('reportList'); if(l)l.style.display='none'; var w=document.getElementById('reportWrap'); if(w)w.style.display='flex'; renderReportTabs(); }
  // ONE reading-room opener for every report kind: state + rail + reader bar + a labelled loading state that
  // stays up until the iframe's load event (showReportLoading / the #reportFrame onload in wireReportFrame).
  function openInReadingRoom(id,kind,bundleId){
    state.reportRunId=id; state.reportKind=kind; state.reportBundleId=(kind==='bundle')?bundleId:state.reportBundleId; state.activeRunId=id;   // keep the report topbar (activeRun) in sync when opened from the all-reports grid
    showReportFrame();
    var empty=document.getElementById('reportEmpty');
    empty.style.display='none';
    var want=reportFrameSrc(id,kind,bundleId); state.reportFrameWant=want;
    showReportLoading(true);
    var f=swapReportFrame(want,true);
    if(f&&!f._rzLoadWired){ f._rzLoadWired=true; f.addEventListener('load',function(){ var w=state.reportFrameWant; if(w&&String(f.src||'').indexOf(w)>=0) showReportLoading(false); }); }
    renderReportToggle(); go('report'); syncReportUrl();
  }
  // Point the reading-room iframe at src WITHOUT a browser-history entry: re-navigating a loaded iframe (f.src=…) adds
  // a joint-session-history entry, so Back stepped the hidden frame instead of the console (tab switches, ← All reports).
  // A fresh clone's first navigation replaces its initial about:blank, so it adds none. src '' = blank (no navigation).
  function swapReportFrame(src,show){
    var old=document.getElementById('reportFrame'); if(!old||!old.parentNode) return null;
    var f=old.cloneNode(false);
    if(src) f.setAttribute('src',src); else f.removeAttribute('src');
    f.style.display=show?'block':'none';
    old.parentNode.replaceChild(f,old);
    return f;
  }
  function showReportLoading(on){ var l=document.getElementById('reportLoading'); if(l) l.hidden=!on; }
  // The sandboxed report iframe asks us to open an evidence permalink (see accelOpenLinkAllowed). Only messages from
  // the reading-room iframe itself count, and only for the run it is showing.
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data; if(!d||d.type!=='accel-open-link') return;
    var f=document.getElementById('reportFrame'); if(!f||ev.source!==f.contentWindow) return;
    var run=(state.runs||[]).find(function(r){ return r.id===state.reportRunId; });
    if(!accelOpenLinkAllowed(d.href,run)) return;
    window.open(String(d.href),'_blank','noopener,noreferrer');
  });
  function showReport(id,kind){
    kind=(kind==='leadership'||kind==='workitems')?kind:'internal';
    openInReadingRoom(id,kind);
  }
  function openReport(id){ var k=startHereKind(runById(id)); if(k==='combined') openCombined(id); else showReport(id,k); }   // the guide's "Start here" report
  function openLeadership(id){ showReport(id,'leadership'); }
  function openWorkItems(id){ showReport(id,'workitems'); }
  // A per-bundle AREA report is standalone. It MUST keep reportRunId set (with
  // kind='bundle' + reportBundleId) — clearing reportRunId made showPanel('report') fall into the all-reports GRID
  // branch, so go('report') immediately replaced the iframe with the report list. (bugfix)
  function openBundleReport(id,bundleId){ openInReadingRoom(id,'bundle',bundleId); }
  // The COMBINED report (Report Normalizer, legacy runs) — its own in-page tabs (kind='combined').
  function openCombined(id){ openInReadingRoom(id,'combined'); }
  // The PROVENANCE / Design & Evolution report (legacy runs) — standalone (kind='provenance').

  function openProvenance(id){ openInReadingRoom(id,'provenance'); }
  // The all-reports grid (Report tab default view): every FINISHED run with a viewable report, partitioned into
  // the normal view and Trash. Open / Remove→trash / Restore / Empty-trash. Refreshed by loadState on this view.
  // How many report artifacts a run carries (drives the folder badge + whether to open the folder vs the report directly).
  function runReportArtifacts(r){
    var out=[];
    if(isFullScanRun(r)){
      out.push({ kind:'internal', key:'internal', label:internalReportLabel(r), sub:(r.mode==='agentic'?'fix · done when · how to verify · REMEDIATION.md export':'self-contained HTML · evidence + fixes') });
      if(r.leadership) out.push({ kind:'leadership', key:'leadership', label:'Leadership report', sub:'decision brief · what to act on first' });
      return out;
    }
    out.push({ kind:'internal', key:'internal', label:internalReportLabel(r), sub:(r.kind==='design'?'saved design doc · the Design Doc tab was removed':'self-contained HTML · evidence + fixes') });
    if(r.combined) out.push({ kind:'combined', key:'combined', label:'Combined report', sub:'all reports · one tabbed file · unified style' });
    if(r.leadership) out.push({ kind:'leadership', key:'leadership', label:'Leadership report', sub:'numbers-driven brief' });
    if(r.workItems) out.push({ kind:'workitems', key:'workitems', label:'Work items', sub:'engineering checklist · item → location → context' });   // accel-mini fix runs
    (r.bundleReports||[]).forEach(function(br){ out.push({ kind:'bundle', bundleId:br.id, key:'bundle:'+br.id, label:'Area report · '+bundleDisplayName(br.id,br.title), sub:'area-specific' }); });   // UI-21: no raw bundle id — the label already carries the display name
    if(r.provenance) out.push({ kind:'provenance', key:'provenance', label:'Design & Evolution', sub:'recovered from git history' });   // standalone doc-recovery report (legacy runs)
    return out;
  }
  // Compact inline outcome of a per-report "Extract memory" run (Report tab). Reads the cached IntakeResult from
  // state.memExtractResult[id]; empty string when the card has no result yet. FAIL-OPEN: an { error } result shows
  // a short "extract failed" note; anything else shows the applied (new/reinforced/replaced)/discarded tally + a → Memory link.
  function renderMemExtractOutcome(id){
    var r=(state.memExtractResult||{})[id]; if(!r)return '';
    if(r.error){
      return '<div style="margin-top:8px;font-size:12.5px;color:#C0392B">extract failed &middot; '+esc(String(r.error))+'</div>';
    }
    // Writes apply directly now — everything lands in committed (insert|append|supersede); no review queue. Fold any
    // stray queued (back-compat) into the applied tally. Discarded = extractions dropped by dedup.
    var committed=(r.committed&&r.committed.length)?r.committed:[];
    var queued=(r.queued&&r.queued.length)?r.queued:[];
    var applied=committed.concat(queued);
    var discarded=(r.discarded&&r.discarded.length)?r.discarded:[];
    var newN=applied.filter(function(c){ return c&&c.action==='insert'; }).length;
    var reinfN=applied.filter(function(c){ return c&&c.action==='append'; }).length;
    var replN=applied.filter(function(c){ return c&&c.action==='supersede'; }).length;
    var discN=discarded.length;
    return '<div style="margin-top:8px;font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      +'<span>&#10022; applied to memory: '+newN+' new &middot; '+reinfN+' reinforced'
        +(replN?(' &middot; '+replN+' replaced'):'')
        +(discN?(' &middot; '+discN+' discarded'):'')+'</span>'
      +'<span class="mem-golink" data-go="memory" role="button" tabindex="0" style="cursor:pointer;color:var(--honey-link);font-weight:600">&rarr; Memory</span>'
      +'</div>';
  }
  // Deep-linkable report URLs — mirrors /run?run=<id>: an OPEN report is /report?run=<id>&kind=<internal|
  // leadership|workitems|combined|bundle>[&bundle=<bid>], a run FOLDER is /report?folder=<id>, the all-reports
  // grid is bare /report. syncReportUrl writes the URL from state (replaceState — no history spam); applyReportUrl
  // reads it back on entry (shared link / reload / back-forward). Guarded by reportUrlApplied so the pre-data
  // first paint can't wipe a deep link before loadState has the runs to apply it.
  function syncReportUrl(){
    // A reading-room TAB switch (state.reportTabPush, set by the tab click) PUSHES so Back returns to the previous tab
    // (popstate → applyReportUrl restores it); everything else replaces. Consumed on every call, whatever the outcome.
    var tabPush=!!state.reportTabPush; state.reportTabPush=false;
    if(!state.reportUrlApplied||currentView()!=='report') return;
    var u='/report';
    if(state.reportRunId){ u+='?run='+encodeURIComponent(state.reportRunId)+'&kind='+encodeURIComponent(state.reportKind||'internal'); if(state.reportKind==='bundle'&&state.reportBundleId) u+='&bundle='+encodeURIComponent(state.reportBundleId); }
    else if(state.reportFolderRun) u+='?folder='+encodeURIComponent(state.reportFolderRun);
    var op=reportHistoryOp(location.pathname+location.search,u,tabPush);
    if(op==='push') history.pushState(null,'',u); else if(op==='replace') history.replaceState(null,'',u);
  }
  function applyReportUrl(){
    if(currentView()!=='report') return false;
    var p; try{ p=new URLSearchParams(location.search); }catch(_){ return false; }
    var rid=p.get('run'), fid=p.get('folder');
    if(rid&&runById(rid)){
      var kind=p.get('kind')||'internal';
      if(kind==='bundle'&&p.get('bundle')) openBundleReport(rid,p.get('bundle'));
      else if(kind==='combined') openCombined(rid);
      else if(kind==='provenance') openProvenance(rid);
      else showReport(rid,kind);
      return true;
    }
    if(fid&&runById(fid)){ state.reportFolderRun=fid; state.reportRunId=null; state.reportKind=null; renderReportList(); return true; }
    return false;
  }
  // Full return to the top-level all-reports list: close any open report frame + exit the folder drill-in +
  // leave the trash view. Wired to the report topbar action and reusable by the back buttons.
  function backToAllReports(){
    swapReportFrame('',false);
    state.reportFolderRun=null; state.reportTrashView=false; renderReportList();
  }
  function renderReportList(){
    var lst=document.getElementById('reportList'); if(!lst) return;
    showReportLoading(false); state.reportFrameWant=null;
    state.reportRunId=null; state.reportKind=null;
    var w=document.getElementById('reportWrap'); if(w)w.style.display='none';
    var tog=document.getElementById('reportToggle'); if(tog)tog.style.display='none';
    lst.style.display='block';
    // FOLDER drill-in: when a run folder is open, show that run's report artifacts (internal + leadership + each area).
    // Resolve it BEFORE renderTopbar so activeRunId reflects the folder's run on EVERY entry path (click, loadState
    // re-render, navigating back to /report) — else the topbar action targets a previously-selected run
    // A stale/missing folder id falls back to the flat list.
    var fr=state.reportFolderRun?runById(state.reportFolderRun):null;
    if(state.reportFolderRun && !fr) state.reportFolderRun=null;
    if(fr) state.activeRunId=state.reportFolderRun;
    syncReportUrl();   // list/folder/trash transitions all land here → keep the shareable URL in step
    renderTopbar('report');   // reportRunId is null → topbar shows the active (folder) run, or "Report"
    // The LIBRARY list and the folder drill-in share --content-wide (console polish: was a 1200px deck column, which
    // left wide empty margins on big screens) — set per-branch since both render into the same #reportList node.
    if(fr){ lst.style.maxWidth='var(--content-wide)'; lst.style.padding='18px 30px'; return renderReportFolder(lst, fr); }
    lst.style.maxWidth='var(--content-wide)'; lst.style.padding='20px 30px 44px';
    var trashV=!!state.reportTrashView;
    var all=(state.runs||[]).filter(function(r){return r.hasReport;});
    var rows=all.filter(function(r){return !!r.trashed===trashV;});
    var trashN=all.filter(function(r){return !!r.trashed;}).length;
    // Search + kind filter over the library (45+ runs had no way to find one). The stat strip counts what is shown.
    var libTotal=rows.length, libKind=state.libKind||'all';
    if(!trashV) rows=filterLibraryRuns(rows,state.libQuery,libKind);
    var LIB_KINDS=[['all','All'],['scan','Full Scan'],['ask','Quick Ask'],['audit','Rec audit (legacy)']];
    var libBar=(trashV||!libTotal)?'':'<div class="lib-bar" role="search"><input id="libSearch" type="search" class="lib-search" placeholder="Search reports — title, id, scope, question…" aria-label="Search reports" value="'+esc(state.libQuery||'')+'">'
      +'<div class="run-filters" role="group" aria-label="Report kind">'+LIB_KINDS.map(function(k){ return '<button class="run-filter'+(libKind===k[0]?' active':'')+'" data-act="lib-kind" data-kind="'+k[0]+'" aria-pressed="'+(libKind===k[0]?'true':'false')+'">'+k[1]+'</button>'; }).join('')+'</div></div>';
    var head='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
      +'<div class="mono" style="font-size:10.5px;color:var(--num);text-transform:uppercase;letter-spacing:.12em;flex:1">'+(trashV?'Trash · '+rows.length:'Finished reports · '+(rows.length===libTotal?rows.length:(rows.length+' of '+libTotal)))+'</div>'
      +'<button class="btn ghost" data-act="report-trash-toggle" style="font-size:12.5px;padding:5px 11px;border-radius:8px">'+(trashV?'← Back to reports':'Trash'+(trashN?' ('+trashN+')':''))+'</button>'
      +(trashV&&rows.length?'<button class="btn ghost" data-act="report-empty" style="font-size:12.5px;padding:5px 11px;border-radius:8px;color:var(--crit)">Empty trash</button>':'')+'</div>';
    if(!rows.length){ lst.innerHTML=head+libBar+'<div style="color:var(--muted);font-size:14px;padding:20px 2px">'+libraryEmptyText({ trash:trashV, total:libTotal, query:state.libQuery, kindLabel:(LIB_KINDS.filter(function(k){return k[0]===libKind;})[0]||[])[1], kind:libKind })+'</div>'; restoreLibSearchFocus(); return; }
    // Library stat strip — 3 joined cells (finished reports · findings across runs · total spend) over the
    // visible (non-trashed) rows, matching the redesign's grid-with-1px-line seams.
    var statsHtml='';
    if(!trashV){
      var findingsTot=0, spendTot=0, hasSpend=false;
      rows.forEach(function(r){
        if(r.findings!=null&&r.kind!=='ask'&&r.kind!=='design'){ var fn=Number(r.findings); if(!isNaN(fn)) findingsTot+=fn; }
        if(r.costUsd!=null){ var c=Number(r.costUsd); if(!isNaN(c)){ spendTot+=c; hasSpend=true; } }
      });
      var cell=function(v,k){ return '<div class="lib-stat"><div class="mono lib-stat-n">'+v+'</div><div style="font-size:12px;color:var(--muted);margin-top:4px">'+k+'</div></div>'; };
      statsHtml='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:16px;box-shadow:var(--card-shadow)">'
        +cell(rows.length,'finished reports')+cell(findingsTot,'findings across runs')+cell(hasSpend?esc(money(spendTot)):'—','total spend')+'</div>';
    }
    var cards=rows.map(function(r){
      // A run is a FOLDER: the whole card opens the run's report list; Remove/Restore stay as side actions.
      var memBusy=!!(state.memExtractBusy||{})[r.id];
      var editingThis=(state.editingTitleRunId===r.id);
      var openAttr=(trashV||editingThis)?'':' data-act="report-open-folder" data-id="'+esc(r.id)+'" role="button" tabindex="0"';
      var kindLab=r.kind==='ask'?'quick ask':(r.kind==='audit'?'rec audit (legacy)':(r.kind==='design'?'design doc (legacy)':'full scan'));
      var kindCol=(r.kind==='ask'||r.kind==='audit'||r.kind==='design')?'var(--ink2)':'var(--num)';
      var titleRow=editingThis
        ? '<span class="run-title-row" style="display:flex;align-items:center;gap:6px;flex:1;min-width:0"><input class="run-title-input" data-act="title-input" data-id="'+esc(r.id)+'" value="'+esc(runTitle(r))+'" spellcheck="false" autocomplete="off" style="flex:1;min-width:0;font:inherit;padding:2px 6px;border:1px solid var(--line);border-radius:6px;background:var(--cream-card);color:var(--espresso)"><span class="run-title-act" data-act="title-save" data-id="'+esc(r.id)+'" role="button" tabindex="0" title="Save" style="cursor:pointer;padding:0 5px">✓</span><span class="run-title-act" data-act="title-cancel" data-id="'+esc(r.id)+'" role="button" tabindex="0" title="Cancel" style="cursor:pointer;padding:0 5px;color:var(--muted)">✕</span></span>'
        : '<span style="font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">'+esc(runTitle(r))+'</span>'+(trashV?'':'<button type="button" class="run-title-pencil" data-act="report-title-edit" data-id="'+esc(r.id)+'" aria-label="Rename" title="Rename report" style="flex:none;font-size:12px">✎</button>');
      var statTxt=(((r.findings!=null&&r.kind!=='ask'&&r.kind!=='design')?findingsLabel(r.findings):'')||'—')+' · '+money(r.costUsd);   // "18 findings", not a bare "18"
      // Extract memory / Remove live IN the title row, always visible (the old hover-revealed
      // absolute cluster at the bottom-right landed on top of the artifact chips).
      var titleActs=trashV?'':'<span class="rf-title-acts">'
        +'<button class="rf-side-act" data-act="mem-extract-report" data-run-id="'+esc(r.id)+'" title="Paid — one model call reads this run&#39;s reports and adds what they learned to memory"'+(memBusy?' disabled':'')+'>'+(memBusy?'Extracting…':'Extract memory')+'</button>'
        +'<span class="rf-act-sep">·</span>'
        +'<button class="rf-side-act danger" data-act="report-trash" data-id="'+esc(r.id)+'">Remove</button></span>';
      var right=trashV
        ? '<button class="btn ghost" data-act="report-restore" data-id="'+esc(r.id)+'" style="font-size:12.5px;padding:5px 11px;border-radius:8px;flex:none">Restore</button>'
        : titleActs
          +'<span class="mono" style="font-size:12px;color:var(--num);font-weight:600;white-space:nowrap;flex:none">'+esc(statTxt)+'</span>'
          +'<span style="font-size:13px;color:var(--num);font-weight:600;white-space:nowrap;flex:none">Open →</span>';
      // Chip order mirrors the redesign library: leadership → combined → detailed/answer → work items →
      // areas → REMEDIATION.md (full-scan runs also get the agent-runnable Markdown export as a chip).
      var arts=runReportArtifacts(r).slice();
      if(!trashV&&r.kind!=='ask'&&r.kind!=='design'&&!isFullScanRun(r)) arts.push({ kind:'remediation', key:'remediation', label:'REMEDIATION.md', sub:(r.findings!=null?r.findings+' findings · ':'')+'agent-runnable' });
      var CHIP_RANK={leadership:0,combined:1,internal:2,plan:2.5,workitems:3,bundle:4,provenance:5,remediation:6};
      arts.sort(function(a,b){ return (CHIP_RANK[a.kind]!=null?CHIP_RANK[a.kind]:9)-(CHIP_RANK[b.kind]!=null?CHIP_RANK[b.kind]:9); });
      var chips=trashV?'':arts.map(function(a){
        var oa=a.kind==='bundle'
          ? 'data-act="report-open-art" data-id="'+esc(r.id)+'" data-artkind="bundle" data-bundle="'+esc(a.bundleId)+'"'
          : a.kind==='remediation'
            ? 'data-act="export-md" data-id="'+esc(r.id)+'"'
            : 'data-act="report-open-art" data-id="'+esc(r.id)+'" data-artkind="'+esc(a.kind)+'"';
        var nm=a.kind==='bundle'?a.label.replace(/^Area report · /,'Area · '):a.label;
        return '<span class="rf-chip" '+oa+' role="button" tabindex="0" title="'+esc(a.sub)+'"><span class="g">▦</span>'+esc(nm)+'</span>';
      }).join('');
      return '<div class="rfolder"'+openAttr+' style="border:1px solid var(--line);border-radius:14px;padding:13px 16px;margin-bottom:11px;background:var(--cream-card);box-shadow:var(--card-shadow)'+(openAttr?';cursor:pointer':'')+'">'
        +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0">'
          +(r.alias?'<span class="mono" style="font-size:11px;color:var(--num);white-space:nowrap;flex:none">'+esc(r.alias)+'</span>':'')
          +'<span class="mono" style="font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:'+kindCol+';border:1px solid var(--line);border-radius:999px;padding:2px 8px;white-space:nowrap;flex:none">'+esc(kindLab)+'</span>'
          +'<div style="flex:1;min-width:120px;display:flex;align-items:center;gap:6px;overflow:hidden">'+titleRow+'</div>'
          +right
        +'</div>'
        +(chips?'<div class="rf-chips">'+chips+'</div>':'')
        +(trashV?'':renderMemExtractOutcome(r.id))+'</div>';
    }).join('');
    lst.innerHTML=head+statsHtml+(trashV?'':'<div style="font-size:14px;color:var(--ink2);line-height:1.55;margin:0 0 16px">Every finished run keeps its generated reports here. Open one to read it inline — answer, work items, and the memory it touched.</div>')+libBar+cards;
    restoreLibSearchFocus();
    if(state.editingTitleRunId){ var _ci=lst.querySelector('.run-title-input'); if(_ci){ _ci.focus(); try{_ci.select();}catch(e){} } }   // focus the inline title editor
  }
  // The library re-renders on every keystroke — put the caret back where you were typing.
  function restoreLibSearchFocus(){ if(!state.libSearchFocus) return; var el=document.getElementById('libSearch'); if(!el) return; try{ el.focus(); var n=el.value.length; el.setSelectionRange(n,n); }catch(_){} }
  // The user's original question / request for a run, shown ABOVE the report artifacts in the folder view so
  // the primary answer context reads first. ask runs → the raw question (+ optional scope); org/audit
  // runs → the run brief when present. Returns '' when there's nothing meaningful to show.
  function reportQuestionCard(r){
    var q=String((r.kind==='ask'?r.question:r.brief)||'').trim();
    if(!q) return '';
    var lab=r.kind==='ask'?'Your question':'Brief · your request';

    var scope=String(r.scope||'').trim();   // /api/state emits ask scope as r.scope (server.ts:2482), not askScope
    var scopeHtml=(r.kind==='ask'&&scope)?'<div class="mono" style="font-size:11px;color:var(--muted);margin-top:8px">Scope · '+esc(scope)+'</div>':'';
    var qLong=q.length>240||(q.match(/\n/g)||[]).length>=4;   // clamp long / many-line briefs to 4 rows
    var qOpen=!!state.folderBriefOpen;
    return '<div class="rd-card rd-brief" style="margin-bottom:14px"><div class="rd-brief-lab">'+esc(lab)+'</div>'
      +'<div class="rd-brief-txt'+(qLong&&!qOpen?' clamp':'')+'">'+esc(q)+'</div>'
      +(qLong?'<button class="rd-brief-more" data-act="toggle-folder-brief">'+(qOpen?'See less':'See more')+'</button>':'')
      +scopeHtml+'</div>';
  }
  // Memory layer (method receipt): the reusable diagnostic method THIS run reinforced, saved to local memory.
  // Value-free (pattern title + signal keywords only). Rendered under the generated-reports list. Empty
  // string when the run recorded no learned method (r.learned from /api/state).
  function renderMemoryReceipt(r){
    var m=r&&r.learned; if(!m||!m.pattern) return '';
    var sig=(m.signature||[]).map(function(s){return '<span class="mem-pill">'+esc(s)+'</span>';}).join('');
    // Next-run auto-checks: show the first 3, collapse the rest behind a CSS-only See more/less toggle so the card stays short.
    var allChecks=(m.checks||[]); var LIMIT=3;
    var memLi=function(c,extra){return '<li'+(extra?' class="'+extra+'"':'')+'><span class="mk">&rsaquo;</span>'+esc(c)+'</li>';};
    var checksHtml='';
    if(allChecks.length){
      if(allChecks.length<=LIMIT){ checksHtml='<div class="mem-lab">Next run auto-checks</div><ul class="mem-checks">'+allChecks.map(function(c){return memLi(c);}).join('')+'</ul>'; }
      else {
        var mcid='memchk-'+esc(r.id);
        checksHtml='<div class="mem-lab">Next run auto-checks</div>'
          +'<input type="checkbox" id="'+mcid+'" class="rc-tgl" hidden>'
          +'<ul class="mem-checks">'+allChecks.slice(0,LIMIT).map(function(c){return memLi(c);}).join('')+allChecks.slice(LIMIT).map(function(c){return memLi(c,'rc-rest-li');}).join('')+'</ul>'
          +'<label for="'+mcid+'" class="rc-more rc-show">See more ('+(allChecks.length-LIMIT)+') &#9662;</label>'
          +'<label for="'+mcid+'" class="rc-more rc-hide">See less &#9652;</label>';
      }
    }
    var sv=m.saved||{}; var addN=sv.added||0, updN=sv.updated||0, totN=sv.total||0;
    return '<div class="mem-b">'
      +'<div class="mem-b-head"><span class="mem-b-glyph"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a4 4 0 0 0-4 4 3 3 0 0 0-2 5 3 3 0 0 0 2 5 4 4 0 0 0 8 0 3 3 0 0 0 2-5 3 3 0 0 0-2-5 4 4 0 0 0-4-4Z"/><path d="M12 7v13"/></svg></span><h3>Reusable method learned</h3><span class="eyebrow" style="margin-left:auto">memory</span></div>'
      +'<div class="mem-b-grid">'
        +'<div class="mem-b-main">'
          +'<div class="eyebrow" style="color:var(--honey-link)">Method</div>'
          +'<div class="mem-b-ptn">'+esc(m.pattern)+'</div>'
          +(sig?'<div class="mem-lab">Symptom signature</div><div class="mem-sig">'+sig+'</div>':'')
          +checksHtml
        +'</div>'
        +'<div class="mem-b-side">'
          +'<div class="eyebrow" style="color:var(--honey-link)">Saved to local memory</div>'
          +'<div class="mem-receipt">'
            +'<div class="mem-metric"><div class="n pos">+'+addN+'</div><div class="k">new method'+(addN===1?'':'s')+'</div></div>'
            +'<div class="mem-metric"><div class="n">'+updN+'</div><div class="k">reinforced</div></div>'
          +'</div>'
          +(totN?'<div class="mem-metric" style="margin-top:8px"><div class="n">'+totN+'</div><div class="k">methods in memory</div></div>':'')
          +'<div class="mem-priv"><span class="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><span>Value-free method only &mdash; no names, numbers, or rows copied.</span></div>'
        +'</div>'
      +'</div></div>';
  }
  // ---------- Memory tab (browse) ----------
  // Fetch /api/memory once per visit, cache on state.mem, then paint the cards (local store on this machine): filter
  // chips by type + a text search + click-to-expand the body. Cards are editable when writes are enabled.
  function renderMemory(){
    var host=document.getElementById('memoryBody'); if(!host)return;
    if(!state.mem&&!state.memLoading){ state.memLoading=true;
      api('/api/memory').then(function(r){return r.json();}).then(function(d){ state.mem=d||{}; state.memLoading=false; renderMemory(); }).catch(function(){ state.mem={org:null,version:0,total:0,cards:[]}; state.memLoading=false; renderMemory(); });
    }
    if(!state.mem){ host.innerHTML='<div class="rd-card" style="margin-top:16px;color:var(--muted)">Loading memory&hellip;</div>'; return; }
    var m=state.mem; var all=m.cards||[]; var version=m.version||0; var total=(m.total!=null?m.total:all.length);
    // Whether writes (edit/delete) are enabled server-side — threaded to the full-card actions + click handlers.
    var canWrite=!!(state.mem&&state.mem.canWrite); memCanWrite=canWrite;
    // header row: version/count label + sub-tabs.
    var mv=state.memView; var isHist=mv==='history'; var isAdd=mv==='add';
    var subtab='<div class="mem-subtab" style="margin-left:auto">'
      +'<button class="'+(mv==='cards'?'on':'')+'" data-act="mem-view" data-view="cards">Cards</button>'
      +'<button class="'+(isHist?'on':'')+'" data-act="mem-view" data-view="history">History</button>'
      +'<button class="'+(mv==='compare'?'on':'')+'" data-act="mem-view" data-view="compare">Compare</button>'
      +'<button class="'+(isAdd?'on':'')+'" data-act="mem-view" data-view="add">Add</button>'
      +'</div>';
    var header='<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 16px">'
      +'<span class="mono" style="font-size:13px;color:var(--muted)">v<b style="color:var(--num);font-weight:600">'+esc(version)+'</b> &middot; <b style="color:var(--num);font-weight:600">'+total+'</b> cards</span>'
      +subtab
      +'</div>';
    // Stats row (deck): active / reinforced·7d / disputed — derived from REAL data (the version is a muted footer, UI-14). "Reinforced · 7d"
    // counts append events in the last 7 days from the history feed (same lazy fetch History uses; '…' till loaded).
    var nActive=all.filter(function(c){return !c.state||c.state==='active';}).length;
    var nDisputed=all.filter(function(c){return c.state==='disputed';}).length;
    var reinf7='&hellip;';
    if(state.memHistory){ var cut=Date.now()-7*24*3600*1000; var rn=0; for(var hi=0;hi<state.memHistory.length;hi++){ var ev=state.memHistory[hi]; if(ev.action==='append'){ var tms=Date.parse(ev.at); if(!isNaN(tms)&&tms>=cut) rn++; } } reinf7=String(rn); }
    else if(!state.memHistoryLoading){ state.memHistoryLoading=true;
      api('/api/memory/history').then(function(r){return r.json();}).then(function(d){ state.memHistory=(d&&d.events)||[]; state.memHistoryLoading=false; renderMemory(); }).catch(function(){ state.memHistory=[]; state.memHistoryLoading=false; renderMemory(); });
    }
    var statsRow='<div class="mem-stats">'
      +'<div class="mem-stat"><div class="n">'+nActive+'</div><div class="k">active cards</div></div>'
      +'<div class="mem-stat"><div class="n">'+reinf7+'</div><div class="k">reinforced &middot; 7d</div></div>'
      +'<div class="mem-stat"><div class="n">'+nDisputed+'</div><div class="k warn">disputed</div></div>'   // deck: numeral stays --num, the LABEL is orange
      +'</div>';
    var verFoot='<div class="mem-ver">memory version v'+esc(version)+'</div>';
    // History sub-tab: a reverse-chron timeline of memory changes. Renders in place of the tier browse. Rows are
    // expandable to the full card (reusing the Cards flow) — so mirror the Cards tail: fetch any expanded card's
    // full detail if not cached, and bind edit-form inputs so an in-row edit doesn't lose keystrokes on re-render.
    if(isHist){
      host.innerHTML='<div class="mem-wrap">'+header+renderMemHistory()+'</div>';
      Object.keys(state.memExpanded).forEach(function(id){ if(state.memExpanded[id])ensureMemFull(id); });
      bindMemEditInputs();
      return;
    }
    // Compare sub-tab (cross-project memory): the deterministic project x entity-key matrix from
    // GET /api/org/facts/compare (visibility-filtered server-side), cached per kind filter on state.memCmp.
    if(mv==='compare'){
      host.innerHTML='<div class="mem-wrap">'+header+renderMemCompare()+'</div>';
      return;
    }
    // Add sub-tab (entrypoint iii): a freeform "draft to memory" box. Renders in place of the tier browse.
    if(isAdd){
      host.innerHTML='<div class="mem-wrap">'+header+renderMemAdd()+'</div>';
      return;
    }
    // Cards browse: every card in local memory (repo-bound cards carry repo chips). Filter chips by type + a text
    // search + click-to-expand the body.
    var tierAll=all;
    // filter chips (All + the 6 types) — active chip is highlighted; clicking sets state.memFilter.
    function chip(val,label,n){ var on=state.memFilter===val; return '<button class="mem-chip'+(on?' on':'')+'" data-act="mem-filter" data-mem-filter="'+esc(val)+'">'+esc(label)+(n!=null?' <span class="mem-chip-n">'+n+'</span>':'')+'</button>'; }
    var chips=chip('all','All',tierAll.length);
    for(var ci=0;ci<MEM_TYPES.length;ci++){ var ty=MEM_TYPES[ci]; var cnt=tierAll.filter(function(c){return (c.type||'')===ty;}).length; chips+=chip(ty,ty,cnt); }
    var chipRow='<div class="mem-chips">'+chips+'</div>';
    var searchRow='<div class="mem-search"><input id="memSearch" placeholder="Search cards&hellip;" value="'+esc(state.memQuery||'')+'"></div>';
    // apply the type filter + text search.
    var q=(state.memQuery||'').trim().toLowerCase();
    var filtered=tierAll.filter(function(c){
      if(state.memFilter!=='all'&&(c.type||'')!==state.memFilter)return false;
      if(q){ var hay=((c.short_desc||'')+' '+(c.body||'')+' '+(c.type||'')).toLowerCase(); if(hay.indexOf(q)<0)return false; }
      return true;
    });
    var list;
    if(!filtered.length){ list='<div class="mem-empty">No cards match this filter.</div>'; }
    else {
      list=filtered.map(function(c){
        var id=c.id||('idx'+all.indexOf(c)); var open=!!state.memExpanded[id];
        // On expand we render the FULL card (fetched lazily via /api/memory/card and cached on state.memFull),
        // or the edit form when this card is in edit mode. The lean list card only knows short_desc/type.
        var bodyHtml=open?('<div class="mem-card-body">'+memCardBodyHtml(id)+'</div>'):'';
        var caret='<span class="mem-card-caret">'+(open?'&minus;':'+')+'</span>';
        // 3px colored left border by card state: green active · orange disputed · muted retired/superseded/candidate-less states.
        var stCls=(c.state==='disputed')?'st-warn':((c.state==='retired'||c.state==='superseded')?'st-dim':'st-ok');
        // Repo-binding chips (repo dimension): one honey chip per bound repo, name only, full owner/name on hover.
        var reposArr=Array.isArray(c.repos)?c.repos:[];
        var repoRow=reposArr.length?('<div class="mem-card-repos">'+reposArr.map(function(r){var rn=String(r).split('/').pop(); return '<span class="mem-repo" title="'+esc(String(r))+'">'+esc(rn)+'</span>';}).join('')+'</div>'):'';
        return '<div class="mem-card '+stCls+'"><div class="mem-card-head" data-act="mem-expand" data-mem-id="'+esc(id)+'">'
          +'<span class="mem-card-type">'+esc(c.type||'card')+'</span>'
          +'<span class="mem-card-desc">'+esc(c.short_desc||'')+'</span>'
          +caret+'</div>'+repoRow+bodyHtml+'</div>';
      }).join('');
    }
    var mainHead='<div class="mem-main-head"><span class="mem-tierpill" style="cursor:default"><span class="tl">Memory cards</span></span><span class="mem-head-org">stored on this machine</span></div>';
    var mainBody;
    if(!tierAll.length){
      mainBody='<div class="mem-tier-empty"><div class="glyph">&#10022;</div><div class="t">No memory cards yet</div>'
        +'<p>Memory fills when a run ticks &ldquo;Save learnings to memory&rdquo; (Full Scan or Quick Ask), from a report&rsquo;s &ldquo;Extract memory&rdquo;, or from Add.</p><div class="big">0</div><div class="sub">cards</div></div>';
    } else { mainBody=chipRow+searchRow+'<div class="mem-list">'+list+'</div>'; }
    var tier1='<div class="mem-main-card">'+mainHead+'<div style="padding:14px 16px">'+mainBody+'</div></div>';
    // Right rail: BY TYPE (name/count row in --ink2 with mono --num count, honey bar over --card2 track).
    var btMax=0, btRows='';
    for(var bi=0;bi<MEM_TYPES.length;bi++){ var bc=all.filter(function(c){return (c.type||'')===MEM_TYPES[bi];}).length; if(bc>btMax)btMax=bc; }
    for(var b2=0;b2<MEM_TYPES.length;b2++){ var t2n=MEM_TYPES[b2]; var t2c=all.filter(function(c){return (c.type||'')===t2n;}).length;
      var pct=btMax?Math.round(t2c/btMax*100):0;
      btRows+='<div><div class="mem-bt-top"><span class="mem-bt-name">'+esc(t2n)+'</span><b class="mem-bt-n">'+t2c+'</b></div>'
        +'<span class="mem-bt-bar"><span class="mem-bt-fill" style="width:'+pct+'%"></span></span></div>';
    }
    var byType='<div class="mem-bytype"><div class="bt-lab">By type</div><div class="mem-bt-list">'+btRows+'</div></div>';
    var nRepoBound=all.filter(function(c){ return Array.isArray(c.repos)&&c.repos.length>0; }).length;
    var scopeCard='<div class="mem-tiers-card">'
      +'<div class="tr-row"><h3>Repo-bound</h3><span class="tr-n">'+nRepoBound+'</span></div><div class="tr-sub">cards tied to a specific repo</div>'
      +'<div class="tr-div"><div class="tr-row"><h3>General</h3><span class="tr-n">'+(all.length-nRepoBound)+'</span></div><div class="tr-sub">apply across your projects</div></div>'
      +'</div>';
    var rail='<div style="align-self:start;display:flex;flex-direction:column;gap:14px">'+byType+scopeCard+'</div>';
    var grid='<div class="mem-grid"><div>'+tier1+'</div>'+rail+'</div>';
    // Preserve scroll across the full innerHTML repaint (expand/collapse, chips, search, lazy card loads all
    // re-render): a fresh .mem-list starts at scrollTop 0, which yanked the view back to the top on every click.
    // A filter/search change swaps the result set — there the list intentionally resets to the top.
    var memKey=state.memFilter+'|'+q;
    var oldList=host.querySelector('.mem-list'); var listScroll=(oldList&&memKey===memListKey)?oldList.scrollTop:0;
    memListKey=memKey;
    var memPanel=document.querySelector('.panel[data-panel="memory"]'); var panelScroll=memPanel?memPanel.scrollTop:0;
    host.innerHTML='<div class="mem-wrap">'+header+statsRow+grid+verFoot+'</div>';
    if(memPanel)memPanel.scrollTop=panelScroll;
    var newList=host.querySelector('.mem-list'); if(newList)newList.scrollTop=listScroll;
    var se=document.getElementById('memSearch'); if(se)se.addEventListener('input',function(e){ state.memQuery=e.target.value||''; renderMemory(); var s2=document.getElementById('memSearch'); if(s2){ try{ s2.focus(); var n=s2.value.length; s2.setSelectionRange(n,n); }catch(_){} } });
    // Any expanded card whose full detail isn't cached yet → fetch it once, then re-render.
    Object.keys(state.memExpanded).forEach(function(id){ if(state.memExpanded[id])ensureMemFull(id); });
    // Wire live edit-form inputs so a re-render (from another card, search, etc.) doesn't lose in-progress edits.
    bindMemEditInputs();
  }
  // ---- Memory: History sub-tab (change timeline) ----
  // Human-friendly entrypoint labels — where a memory change came from.
  var MEM_ENTRYPOINT_LABELS={ 'accel-mini-ask':'Ask', 'full-scan-draft':'Full Scan', 'freeform':'Freeform', 'manual-edit':'Edit', 'manual-delete':'Delete', 'review-approve':'Approved', 'intake':'Intake', 'report-extract':'Report' };
  // Action → { label, css-suffix } for the coloured verb (added/reinforced/replaced/edited/retired).
  var MEM_ACTION_META={ insert:{l:'added',c:'add'}, append:{l:'reinforced',c:'reinforce'}, supersede:{l:'replaced',c:'edit'}, edit:{l:'edited',c:'edit'}, delete:{l:'retired',c:'retire'} };
  function memEntrypointLabel(ep){ return MEM_ENTRYPOINT_LABELS[ep]||String(ep||''); }
  function memActionMeta(ac){ return MEM_ACTION_META[ac]||{l:String(ac||''),c:'edit'}; }
  // Format a UTC ISO timestamp to a readable local time, e.g. "5:56 PM" (day is carried by the day header).
  function memEvTime(iso){ var t=fmtClock(iso); return esc(t||String(iso||'')); }   // Explicit UI locale (fmtClock), never the browser's
  // Day-header label for grouping, e.g. "Jul 2, 2026".
  function memEvDay(iso){ return fmtDay(iso)||String(iso||''); }   // "Aug 2, 2026" in the UI locale, whatever the browser language
  // Build the History view HTML. Lazy-fetches /api/memory/history once, caches on state.memHistory, re-renders.
  function renderMemHistory(){
    if(!state.memHistory&&!state.memHistoryLoading){ state.memHistoryLoading=true;
      api('/api/memory/history').then(function(r){return r.json();}).then(function(d){ state.memHistory=(d&&d.events)||[]; state.memHistoryLoading=false; renderMemory(); }).catch(function(){ state.memHistory=[]; state.memHistoryLoading=false; renderMemory(); });
    }
    if(!state.memHistory&&state.memHistoryLoading){ return '<div class="rd-card" style="color:var(--muted)">Loading history&hellip;</div>'; }
    var evs=state.memHistory||[];
    if(!evs.length){ return '<div class="rd-card"><div class="mem-empty">No memory changes yet.</div></div>'; }
    // Events arrive newest-first; walk in order, emitting a day header whenever the local day changes.
    var rows=''; var curDay=null;
    for(var i=0;i<evs.length;i++){
      var e=evs[i]; var day=memEvDay(e.at);
      if(day!==curDay){ rows+='<div class="mem-hist-day">'+esc(day)+'</div>'; curDay=day; }
      var meta=memActionMeta(e.action);
      var cid=e.card_id||'';
      var summ=(e.summary&&String(e.summary).length)?String(e.summary):'';
      var runLine=memEvMetaLine(e);   // UI-16: run id links to the run; actor shown when present
      // The exact card touched: mono id (mem-link style) + optional type chip, then the fact (summary) below.
      var idLine=cid?('<span class="mem-link mem-ev-cardid">'+esc(cid)+'</span>'):'';
      var typeChip=(e.card_type&&String(e.card_type).length)?('<span class="mt-tier mem-ev-type">'+esc(e.card_type)+'</span>'):'';
      // A card_id makes the row expandable to the FULL card (reusing the Cards tab flow: ensureMemFull + memFullDetailHtml).
      var canExpand=!!cid; var open=canExpand&&!!state.memExpanded[cid];
      var caret=canExpand?('<span class="mem-card-caret mem-ev-caret">'+(open?'&minus;':'+')+'</span>'):'';
      var hdAttrs=canExpand?(' data-act="mem-hist-expand" data-mem-id="'+esc(cid)+'" role="button" tabindex="0" style="cursor:pointer"'):'';
      var expandedHtml=open?('<div class="mem-card-body mem-ev-body">'+memHistExpandedHtml(cid,e)+'</div>'):'';
      // Revert: only for events that ENHANCED a card (append/edit/supersede) or INSERTED one, and only when writes
      // are enabled server-side. Its own data-act — the click-delegation closest-walk resolves it to 'mem-revert'
      // (NOT the row's mem-hist-expand), so clicking Revert never toggles the row open.
      var canRevert=memCanWrite&&cid&&(e.action==='append'||e.action==='edit'||e.action==='supersede'||e.action==='insert');
      var revertBtn=canRevert?('<button class="btn ghost mem-ev-revert" data-act="mem-revert" data-event-id="'+esc(e.id)+'" title="Restore the state before this change" style="font-size:12px;padding:3px 10px;flex:none">Revert</button>'):'';
      rows+='<div class="mem-ev'+(open?' open':'')+'">'
        +'<div class="mem-ev-time">'+memEvTime(e.at)+'</div>'
        +'<div class="mem-ev-main">'
          +'<div class="mem-ev-row"'+hdAttrs+'>'
            +'<div class="mem-ev-body-main">'
              +'<div class="mem-ev-hd">'
                +'<span class="mem-ev-chip">'+esc(memEntrypointLabel(e.entrypoint))+'</span>'
                +'<span class="mem-ev-act '+meta.c+'">'+esc(meta.l)+'</span>'
                +typeChip
                +idLine
              +'</div>'
              +(summ?('<div class="mem-ev-card">'+esc(summ)+'</div>'):'')
              +runLine
            +'</div>'
            +revertBtn
            +caret
          +'</div>'
          +expandedHtml
        +'</div>'
      +'</div>';
    }
    return '<div class="rd-card flush"><div style="padding:14px 16px"><div class="mem-hist">'+rows+'</div></div></div>';
  }
  // Expanded full-card detail for a History row. Reuses the EXACT Cards-tab flow — the full card is lazy-fetched
  // via ensureMemFull (cached on state.memFull, shared with Cards) and rendered by memFullDetailHtml, which already
  // includes the Edit + Delete buttons (gated on memCanWrite, wired to mem-edit/mem-delete by data-mem-id). If the
  // card is in edit mode, show the edit form. A missing/retired card (a delete event, or a card since removed) →
  // a small muted "no longer active" line instead of the detail. FAIL-OPEN mirrors memCardBodyHtml.
  function memHistExpandedHtml(id,ev){
    if(state.memEdit[id])return memEditFormHtml(id);
    var full=state.memFull[id];
    if(full==null||state.memFullLoading[id])return '<span style="color:var(--muted)">Loading card&hellip;</span>';
    if(full.__err)return '<span style="color:var(--muted)">Could not load this card. <button class="btn ghost" style="font-size:12px;padding:4px 10px;margin-left:6px" data-act="mem-hist-expand" data-mem-id="'+esc(id)+'">Close</button></span>';
    // A delete/retire event, or a card the backend no longer returns (__miss / retired state) → no editable card.
    var retired=(ev&&ev.action==='delete')||!!full.__miss||(full.state&&String(full.state).toLowerCase()==='retired');
    if(retired)return '<span style="color:var(--muted)">This card is no longer active.</span>';
    return memFullDetailHtml(id,full);
  }
  // ---- Memory: Add sub-tab (freeform "draft to memory" — entrypoint iii) ----
  // A plain-words box: the user types a message, it's intaked ONCE (POST /api/memory/draft → backend extract +
  // dedup + route), and the outcome (applied: new / reinforced / replaced / discarded) is shown from the IntakeResult.
  // NOT an interactive bot. The textarea value is read from the DOM at click time so a re-render can't lose it.
  function renderMemCompare(){
    var k=state.memCmpKind||'';
    if(!state.memCmp||state.memCmp.__kind!==k){
      if(!state.memCmpLoading){ state.memCmpLoading=true;
        api('/api/org/facts/compare'+(k?'?kind='+encodeURIComponent(k):'')).then(function(r){return r.json();}).then(function(d){ state.memCmp=d||{}; state.memCmp.__kind=k; state.memCmpLoading=false; if(currentView()==='memory')renderMemory(); }).catch(function(){ state.memCmp={rows:[],projects:[],kinds:[],__kind:k}; state.memCmpLoading=false; if(currentView()==='memory')renderMemory(); });
      }
      return '<div class="rd-card" style="color:var(--muted)">Loading the cross-project comparison&hellip;</div>';
    }
    return compareMatrixHtml(state.memCmp,state.memCmpQ||'');
  }
  function renderMemAdd(){
    var busy=!!state.memDraftBusy;
    var intro='<div style="color:var(--muted);font-size:14px;line-height:1.6;margin:2px 0 12px">'
      +'Tell me what to remember in plain words &mdash; I&rsquo;ll draft it straight into memory (new facts are added; reinforcements merge).'
      +'</div>';
    var ta='<textarea id="memDraftText" rows="5"'+(busy?' disabled':'')
      +' style="width:100%;border:1px solid var(--line);border-radius:9px;background:var(--card2);color:var(--espresso);padding:10px 12px;font-size:14.5px;line-height:1.6;font-family:inherit;resize:vertical"'
      +' placeholder="e.g. The ranking logic lives in the ranker repo; feed exposure is counted per unique visitor."></textarea>';
    var btn='<div style="margin-top:11px"><button class="btn" data-act="mem-draft"'+(busy?' disabled':'')
      +' style="font-size:14px;padding:8px 16px">'+(busy?'Drafting&hellip;':'Draft to memory')+'</button></div>';
    var box='<div class="rd-card flush" style="margin-bottom:16px">'
      +'<div class="rd-sec-head"><h3>Draft to memory</h3><span class="eyebrow">freeform</span></div>'
      +'<div style="padding:14px 16px">'+intro+ta+btn+'</div></div>';
    return box+renderMemDraftResult();
  }
  // Render the outcome of the last freeform draft from its IntakeResult (state.memDraftResult). Reuses the
  // .mem-ev / .mem-ev-act tints. FAIL-OPEN: an { error } result shows the error; anything else shows the lists.
  function renderMemDraftResult(){
    var r=state.memDraftResult; if(!r)return '';
    if(r.error){
      return '<div class="rd-card"><div style="padding:14px 16px;color:#C0392B;font-size:14px">'+esc(String(r.error))+'</div></div>';
    }
    // Writes now apply directly — every write lands in committed (action is insert|append|supersede); there is
    // no review queue. For back-compat, fold any stray queued entries into the applied list (never a review section).
    var committed=(r.committed&&r.committed.length)?r.committed:[];
    var queued=(r.queued&&r.queued.length)?r.queued:[];
    var applied=committed.concat(queued);
    var discarded=(r.discarded&&r.discarded.length)?r.discarded:[];
    var newN=applied.filter(function(c){ return c&&c.action==='insert'; }).length;
    var reinfN=applied.filter(function(c){ return c&&c.action==='append'; }).length;
    var replN=applied.filter(function(c){ return c&&c.action==='supersede'; }).length;
    var discN=discarded.length;
    var summary='<div class="mem-adds-hd" style="margin-bottom:12px">&#10022; Applied to memory: '
      +newN+' new &middot; '+reinfN+' reinforced'
      +(replN?(' &middot; '+replN+' replaced'):'')
      +(discN?(' &middot; '+discN+' discarded'):'')+'</div>';
    function section(title,rows){
      if(!rows)return '';
      return '<div style="margin-bottom:14px"><div class="mem-hist-day" style="margin-top:0">'+esc(title)+'</div><div class="mem-hist">'+rows+'</div></div>';
    }
    function evRow(actMeta,head,sub){
      return '<div class="mem-ev"><div class="mem-ev-main">'
        +'<div class="mem-ev-hd"><span class="mem-ev-act '+actMeta+'">'+esc(head)+'</span></div>'
        +(sub?('<div class="mem-ev-card">'+esc(sub)+'</div>'):'')
        +'</div></div>';
    }
    // Each applied write: the action verb (via memActionMeta) + the card id it touched.
    var aRows=applied.map(function(c){ var m=memActionMeta(c&&c.action); return evRow(m.c,m.l+'  '+String((c&&(c.id||c.request_id))||'(card)'),''); }).join('');
    var dRows=discarded.map(function(d){ return evRow('retire',String(d.short_desc||'(discarded)'),String(d.reason||'')); }).join('');
    var lists='';
    lists+=section('Applied',aRows);
    lists+=section('Discarded',dRows);
    if(!lists){ lists='<div class="mem-empty">Nothing new was drafted from that message.</div>'; }
    // Switch the Memory sub-view to History (stays inside the Memory tab) so the user can review/correct the writes.
    var hint='<div style="margin-top:2px;font-size:13px;color:var(--muted)">Review or correct these in the '
      +'<span class="mem-golink" data-act="mem-view" data-view="history" role="button" tabindex="0" style="cursor:pointer;color:var(--honey-link);font-weight:600">History tab</span>.</div>';
    return '<div class="rd-card flush"><div style="padding:14px 16px">'+summary+lists+hint+'</div></div>';
  }
  // ---- Post-run Memory surface (ask detail) ----
  // For an ask run that had "Save learnings to memory" ticked, show what THIS run added to memory.
  // Lazy-fetches /api/memory/history?run_id=<run.id> ONCE, caches per-run on state.runMemAdds[id], re-renders.
  // FAIL-OPEN: any fetch error → cache [] so the panel degrades to "no memory changes from this run" (never throws).
  function renderAskMemoryAdds(run){
    var id=run.id;
    if(!state.runMemAdds) state.runMemAdds={};
    if(!state.runMemAddsLoading) state.runMemAddsLoading={};
    if(!(id in state.runMemAdds)&&!state.runMemAddsLoading[id]){ state.runMemAddsLoading[id]=true;
      api('/api/memory/history?run_id='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){ state.runMemAdds[id]=(d&&d.events)||[]; state.runMemAddsLoading[id]=false; renderRunDetail(); renderAskRunDetail(); }).catch(function(){ state.runMemAdds[id]=[]; state.runMemAddsLoading[id]=false; renderRunDetail(); renderAskRunDetail(); });
    }
    if(!(id in state.runMemAdds)){ return '<div class="rd-card flush"><div class="rd-sec-head"><h3>Written to memory</h3><span class="eyebrow">this run</span></div><div style="padding:12px 16px;color:var(--muted)">Loading memory changes&hellip;</div></div>'; }
    var evs=state.runMemAdds[id]||[];
    var head='<div class="rd-sec-head"><h3>Written to memory</h3><span class="eyebrow">this run</span></div>';
    if(!evs.length){ return '<div class="rd-card flush">'+head+'<div style="padding:12px 16px;color:var(--muted)">No memory changes from this run.</div></div>'; }
    // Cap the resting card at 3 rows — a full-scan run can write dozens of learnings and the unbounded
    // list dominated the run page. "See all" expands into a scrollable list (internal scroll, not page bloat).
    var memOpen=!!(state.runMemAddsOpen||{})[id];
    var visible=memOpen?evs:evs.slice(0,3);
    var rows='';
    for(var i=0;i<visible.length;i++){
      var e=visible[i]; var meta=memActionMeta(e.action);
      var cardTxt=(e.summary&&String(e.summary).length)?e.summary:(e.card_id||'');
      rows+='<div class="mem-ev">'
        +'<div class="mem-ev-main">'
          +'<div class="mem-ev-hd"><span class="mem-ev-act '+meta.c+'">'+esc(meta.l)+'</span></div>'
          +'<div class="mem-ev-card">'+esc(cardTxt)+'</div>'
        +'</div>'
      +'</div>';
    }
    var moreBtn='';
    if(evs.length>3){
      moreBtn='<button class="mem-ev-more" data-act="mem-adds-toggle" data-id="'+esc(id)+'">'
        +(memOpen?'See less &uarr;':'See all '+evs.length+' &darr;')+'</button>';
    }
    // Deck recognition banner: tally writes (everything that isn't a reinforce) vs reinforcements, honey-soft strip.
    var added=0, reinforced=0;
    for(var j=0;j<evs.length;j++){ var av=String(evs[j].action||'').toLowerCase(); if(av.indexOf('reinforc')>=0) reinforced++; else added++; }
    var title = added>0
      ? 'Wrote <b>'+added+'</b> learning'+(added===1?'':'s')+' to memory'+(reinforced?' · <b>'+reinforced+'</b> reinforced':'')
      : 'Reinforced <b>'+reinforced+'</b> learning'+(reinforced===1?'':'s')+' in memory';
    var banner='<div class="ask-mem-banner">'
      +'<span class="amb-glyph">&#10022;</span>'
      +'<div class="amb-body"><div class="amb-title">'+title+'</div>'
        +'<div class="amb-sub">&ldquo;Save learnings to memory&rdquo; was on &middot; direct-apply &middot; logged &amp; revertable</div></div>'
      +'<button class="btn ghost" data-go="memory" style="padding:7px 14px;font-size:13px">Open Memory &rarr;</button>'
      +'</div>';
    return '<div class="ask-mem-adds">'+banner
      +'<div class="rd-card flush" style="margin-top:12px">'+head
      +'<div style="padding:12px 16px"><div class="mem-hist'+(memOpen?' mem-hist-scroll':'')+'">'+rows+'</div>'+moreBtn+'</div>'
      +'</div></div>';
  }
  // ---- Memory card: full-detail view + edit form (Phase 1) ----
  // Fetch the FULL card (body/edges/key_entities/provenance) once and cache on state.memFull, then re-render.
  // FAIL-OPEN: on error we cache a marker ({__err:true}) so the body shows a message instead of spinning forever.
  function ensureMemFull(id){
    if(!id)return; if(state.memFull[id]!=null)return; if(state.memFullLoading[id])return;
    state.memFullLoading[id]=true;
    api('/api/memory/card?id='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
      state.memFull[id]=(d&&d.card)?d.card:{__miss:true}; state.memFullLoading[id]=false; if(currentView()==='memory')renderMemory();
    }).catch(function(){ state.memFull[id]={__err:true}; state.memFullLoading[id]=false; if(currentView()==='memory')renderMemory(); });
  }
  // The lean list card used to build the head (short_desc/type/state/version) — found in state.mem.cards.
  function memLeanCard(id){ var arr=(state.mem&&state.mem.cards)||[]; for(var i=0;i<arr.length;i++){ if((arr[i].id||('idx'+i))===id)return arr[i]; } return null; }
  // HTML for an expanded card body: the edit form when in edit mode, else the full-detail view (or a loading/error line).
  function memCardBodyHtml(id){
    if(state.memEdit[id])return memEditFormHtml(id);
    var full=state.memFull[id];
    if(full==null||state.memFullLoading[id])return '<span style="color:var(--muted)">Loading card&hellip;</span>';
    if(full.__err)return '<span style="color:var(--muted)">Could not load this card. <button class="btn ghost" style="font-size:12px;padding:4px 10px;margin-left:6px" data-act="mem-expand" data-mem-id="'+esc(id)+'">Close</button></span>';
    return memFullDetailHtml(id,full);
  }
  // Read-only full detail: body, provenance, linked cards (edges), entities, footer (confidence·state·version) + Edit.
  function memFullDetailHtml(id,c){
    var lean=memLeanCard(id)||{};
    var out='';
    var body=(c.body!=null&&String(c.body).length)?String(c.body):'';
    out+=body?('<div class="mem-full-body md">'+mdLite(body)+'</div>'):'<div style="color:var(--muted);font-size:13.5px">No body.</div>';
    // provenance line: signal · evidence_ptr · run
    var p=c.provenance||{};
    var provBits=[];
    if(p.signal)provBits.push('<b>signal</b> '+esc(p.signal));
    if(p.evidence_ptr)provBits.push('<b>evidence</b> '+esc(p.evidence_ptr));
    var run=p.run_id||p.run_type; if(run)provBits.push('<b>run</b> '+[p.run_type,p.run_id].filter(Boolean).map(esc).join(' &middot; '));   // Escape the PARTS, then join with the entity (joining first double-escaped it to a literal "&amp;middot;")
    if(provBits.length)out+='<div class="mem-sec"><div class="mem-sec-lbl">Provenance</div><div class="mem-prov">'+provBits.join(' &nbsp;&middot;&nbsp; ')+'</div></div>';
    // linked cards from edges: {relation:[targetId,...]}
    var edges=c.edges||{}; var relKeys=Object.keys(edges).filter(function(k){return Array.isArray(edges[k])&&edges[k].length;});
    if(relKeys.length){
      var links='';
      relKeys.forEach(function(rel){ edges[rel].forEach(function(tgt){ links+='<div class="mem-link"><span class="mem-link-rel">'+esc(rel)+'</span>'+esc(tgt)+'</div>'; }); });
      out+='<div class="mem-sec"><div class="mem-sec-lbl">Linked cards</div><div class="mem-links">'+links+'</div></div>';
    }
    // entities
    var ents=Array.isArray(c.key_entities)?c.key_entities:[];
    if(ents.length){
      var chips=ents.map(function(e){ return '<span class="mem-ent">'+esc(e)+'</span>'; }).join('');
      out+='<div class="mem-sec"><div class="mem-sec-lbl">Entities</div><div class="mem-chipset">'+chips+'</div></div>';
    }
    // footer: confidence · state · version (prefer the full card, fall back to the lean list card)
    var conf=(c.confidence!=null?c.confidence:null);
    var st=c.state||lean.state||''; var ver=(c.version!=null?c.version:lean.version);
    var foot=[];
    if(conf!=null)foot.push('confidence '+esc(conf));   // UI-15: spelled out ("conf 0.95 · v99" read as jargon)
    if(st)foot.push(esc(st));
    if(ver!=null)foot.push('version '+esc(ver));
    out+='<div class="mem-foot">'+foot.join(' &nbsp;&middot;&nbsp; ')+'</div>';
    // Edit/Delete only when writes are enabled server-side (memCanWrite from GET /api/memory canWrite). Otherwise
    // a read-only note. The server 403s the mutation routes regardless — this just avoids dead UI.
    out+=(memCanWrite?('<div class="mem-body-actions"><button class="btn ghost" style="font-size:13px;padding:6px 13px" data-act="mem-edit" data-mem-id="'+esc(id)+'">Edit</button>'
      +'<button class="btn ghost" style="font-size:13px;padding:6px 13px;color:#C0392B;border-color:#e6bcae" data-act="mem-delete" data-mem-id="'+esc(id)+'">Delete</button></div>')
      :'<div class="mem-body-actions"><span class="mem-foot" style="border:none;padding:0;margin:0">read-only &middot; memory writes are turned off</span></div>');

    return out;
  }
  // Editable draft: prefill from state.memEdit[id] if present (in-progress), else from the cached full card.
  function memEditDraft(id){
    if(state.memEdit[id])return state.memEdit[id];
    var c=state.memFull[id]||{}; var lean=memLeanCard(id)||{};
    return {
      short_desc:(c.short_desc!=null?c.short_desc:(lean.short_desc||'')),
      body:(c.body!=null?c.body:''),
      type:(c.type||lean.type||'invariant'),
      confidence:(c.confidence!=null?String(c.confidence):''),
      key_entities:(Array.isArray(c.key_entities)?c.key_entities.join(', '):'')
    };
  }
  function memEditFormHtml(id){
    var d=memEditDraft(id);
    var typeOpts=MEM_TYPES.map(function(ty){ return '<option value="'+esc(ty)+'"'+(d.type===ty?' selected':'')+'>'+esc(ty)+'</option>'; }).join('');
    return ''
      +'<label class="mem-edit-lbl">Short description</label>'
      +'<input class="mem-edit-in" id="memEd_short_'+esc(id)+'" data-mem-edit="'+esc(id)+'" data-mem-field="short_desc" type="text" value="'+esc(d.short_desc)+'" />'
      +'<label class="mem-edit-lbl">Body</label>'
      +'<textarea class="mem-edit-in" id="memEd_body_'+esc(id)+'" data-mem-edit="'+esc(id)+'" data-mem-field="body">'+esc(d.body)+'</textarea>'
      +'<div class="mem-edit-row">'
        +'<div><label class="mem-edit-lbl">Type</label><select class="mem-edit-in" id="memEd_type_'+esc(id)+'" data-mem-edit="'+esc(id)+'" data-mem-field="type">'+typeOpts+'</select></div>'
        +'<div><label class="mem-edit-lbl">Confidence (0&ndash;1)</label><input class="mem-edit-in" id="memEd_confidence_'+esc(id)+'" data-mem-edit="'+esc(id)+'" data-mem-field="confidence" type="number" step="0.05" min="0" max="1" value="'+esc(d.confidence)+'" /></div>'
      +'</div>'
      +'<label class="mem-edit-lbl">Key entities (comma-separated)</label>'
      +'<input class="mem-edit-in" id="memEd_entities_'+esc(id)+'" data-mem-edit="'+esc(id)+'" data-mem-field="key_entities" type="text" value="'+esc(d.key_entities)+'" />'
      +'<div class="mem-body-actions">'
        +'<button class="btn" style="font-size:13px;padding:6px 13px" data-act="mem-save" data-mem-id="'+esc(id)+'">Save</button>'
        +'<button class="btn ghost" style="font-size:13px;padding:6px 13px" data-act="mem-cancel" data-mem-id="'+esc(id)+'">Cancel</button>'
      +'</div>';
  }
  // Keep state.memEdit[id] in sync with the DOM inputs so a re-render never drops in-progress edits.
  function bindMemEditInputs(){
    var ins=document.querySelectorAll('[data-mem-edit]');
    for(var i=0;i<ins.length;i++){ (function(el){
      var id=el.getAttribute('data-mem-edit'); var f=el.getAttribute('data-mem-field');
      var handler=function(){ if(!state.memEdit[id])state.memEdit[id]=memEditDraft(id); state.memEdit[id][f]=el.value; };
      el.addEventListener('input',handler); el.addEventListener('change',handler);
    })(ins[i]); }
  }
  // Build the card object to POST from the in-edit draft, preserving edges/provenance/state from the full card.
  function memBuildCard(id){
    var d=memEditDraft(id); var c=state.memFull[id]||{}; var lean=memLeanCard(id)||{};
    var ents=String(d.key_entities||'').split(',').map(function(s){return s.trim();}).filter(function(s){return s.length;});
    var conf=parseFloat(d.confidence); if(isNaN(conf))conf=(c.confidence!=null?c.confidence:undefined);
    var card={ id:id, type:(d.type||c.type||lean.type||'invariant').trim(), short_desc:(d.short_desc||'').trim(), body:d.body||'', key_entities:ents };
    if(c.edges)card.edges=c.edges;               // editing edges is out of scope — preserve
    if(c.provenance)card.provenance=c.provenance; // preserve provenance
    if(conf!=null&&conf!==undefined)card.confidence=conf;
    var st=c.state||lean.state; if(st)card.state=st;
    if(c.ttl_days!=null)card.ttl_days=c.ttl_days;   // preserve ttl_days — the backend upsert sets ttl_days=EXCLUDED.ttl_days, so a human edit that dropped it would wipe the TTL
    if(Array.isArray(c.repos))card.repos=c.repos;   // preserve repo binding on edit (backend also COALESCE-preserves when absent; this makes the round-trip explicit, matching MemoryCard.repos)
    return card;
  }
  // ---- High-risk save confirmation dialog (own overlay node, mirrors the export/node modal pattern) ----
  function openMemSaveDialog(id){
    var card=memBuildCard(id); var lean=memLeanCard(id)||{}; var full=state.memFull[id]||{};
    var conf=(card.confidence!=null?card.confidence:(full.confidence!=null?full.confidence:null));
    var ver=(full.version!=null?full.version:lean.version);
    state.memDialog={ id:id, mode:'save', card:card, confidence:conf, version:ver, busy:false, error:null };
    renderMemDialog();
  }
  function openMemDeleteDialog(id){
    var lean=memLeanCard(id)||{}; var full=state.memFull[id]||{};
    var conf=(full.confidence!=null?full.confidence:null); var ver=(full.version!=null?full.version:lean.version);
    state.memDialog={ id:id, mode:'delete', confidence:conf, version:ver, busy:false, error:null };
    renderMemDialog();
  }
  function closeMemDialog(){ state.memDialog=null; renderMemDialog(); }
  function renderMemDialog(){
    var m=document.getElementById('memDialog'); if(!m)return;
    var s=state.memDialog;
    if(!s){ m.hidden=true; m.innerHTML=''; return; }
    var confTxt=(s.confidence!=null?String(s.confidence):'&mdash;');
    var verTxt=(s.version!=null?('v'+esc(s.version)):'unversioned');
    var hi=(typeof s.confidence==='number'&&s.confidence>=0.7);
    var isDel=(s.mode==='delete');
    var body;
    var confLine='<div style="font-family:var(--font-mono);font-size:12px;color:var(--muted);margin-top:8px">confidence '+confTxt+' &middot; '+verTxt+'</div>';
    if(isDel){
      body='<div style="font-size:14px;color:var(--ink2);line-height:1.6">'
        +'You are DELETING <b>'+esc(s.id)+'</b> from memory. '
        +'It will be RETIRED &mdash; agents stop recalling it and it drops off the card list.</div>'+confLine;
      if(hi)body+='<div class="mem-danger">This is a HIGH-confidence card &mdash; removing an established fact.</div>';
    }else{
      body='<div style="font-size:14px;color:var(--ink2);line-height:1.6">'
        +'You are OVERWRITING <b>'+esc(s.id)+'</b>. '
        +'This changes what EVERY agent recalls and bumps the memory version.</div>'+confLine;
      if(hi)body+='<div class="mem-danger">This is a HIGH-confidence card &mdash; overwriting an established fact.</div>';
    }
    if(s.error)body+='<div class="mem-dlg-err">'+esc(s.error)+'</div>';
    var cAct=isDel?'mem-delete-confirm':'mem-save-confirm';
    var cLbl=isDel?(s.busy?'Deleting&hellip;':'Delete anyway'):(s.busy?'Saving&hellip;':'Save anyway');
    body+='<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">'
      +'<button class="btn ghost" data-act="mem-dialog-cancel">Cancel</button>'
      +'<button class="btn" data-act="'+cAct+'"'+(s.busy?' disabled':'')+'>'+cLbl+'</button>'
      +'</div>';
    m.hidden=false;
    m.innerHTML='<div class="nm-card" role="dialog" aria-modal="true" aria-label="'+(isDel?'Delete card':'High-risk save')+'" style="width:460px">'
      +'<div class="nm-head"><div style="min-width:0"><div class="nm-kicker">memory</div><div class="nm-title">'+(isDel?'&#9888; Delete card':'&#9888; High-risk save')+'</div><div class="nm-sub">'+esc(s.id)+'</div></div>'
      +'<button class="nm-x" data-act="mem-dialog-cancel" aria-label="Close">&times;</button></div>'
      +'<div class="nm-body">'+body+'</div></div>';
  }
  // Fire the upsert. On success → clear the caches + force a memory re-fetch → renderMemory. On error → show it in the dialog.
  function memSaveConfirm(){
    var s=state.memDialog; if(!s||s.busy)return;
    s.busy=true; s.error=null; renderMemDialog();
    api('/api/memory/save',{method:'POST',body:s.card}).then(function(res){return res.json().then(function(d){return{ok:res.ok,d:d};});}).then(function(r){
      var st=state.memDialog; if(!st||st.id!==s.id)return;   // a stale response must not stomp a dialog for another card
      if(!r.ok||!r.d||r.d.ok===false){ st.busy=false; st.error=(r.d&&r.d.error)||'Save failed'; renderMemDialog(); return; }
      var id=s.id;
      delete state.memFull[id]; delete state.memEdit[id]; delete state.memFullLoading[id];   // drop caches → re-fetch full card
      state.mem=null;   // force the list (versions/counts) to re-fetch
      state.memHistory=null;   // the save wrote a manual-edit event → History must re-fetch to show it
      state.memDialog=null; renderMemDialog();
      renderMemory();
    }).catch(function(){ var st=state.memDialog; if(st){ st.busy=false; st.error='Network error'; renderMemDialog(); } });
  }
  // Fire the DELETE (retire). On success → drop caches + force a memory re-fetch → renderMemory. On error → show it in the dialog.
  function memDeleteConfirm(){
    var s=state.memDialog; if(!s||s.busy)return;
    s.busy=true; s.error=null; renderMemDialog();
    api('/api/memory/delete',{method:'POST',body:{id:s.id}}).then(function(res){return res.json().then(function(d){return{ok:res.ok,d:d};});}).then(function(r){
      var st=state.memDialog; if(!st||st.id!==s.id)return;   // a stale response must not stomp a dialog for another card
      if(!r.ok||!r.d||r.d.ok===false){ st.busy=false; st.error=(r.d&&r.d.error)||'Delete failed'; renderMemDialog(); return; }
      var id=s.id;
      delete state.memFull[id]; delete state.memEdit[id]; delete state.memFullLoading[id]; delete state.memExpanded[id];
      state.mem=null;   // force the list to re-fetch (the card is now retired/gone)
      state.memHistory=null;   // the delete wrote a manual-delete event → History must re-fetch to show it
      state.memDialog=null; renderMemDialog();
      renderMemory();
    }).catch(function(){ var st=state.memDialog; if(st){ st.busy=false; st.error='Network error'; renderMemDialog(); } });
  }
  // QuickAsk memory (run views): the dark COMPACT "pattern recognized" terminal — read-only, with NO save counts, so
  // it reads distinct from the full-scan card. Shown on the Quick Ask tab (renderAskMemory) and the ask run detail. Empty when the ask matched nothing.
  function renderRecognitionTerminal(run){
    var m=run&&run.recognized; if(!m||!m.pattern) return '';
    // Drop the headline pattern from the auto-check list — it's already the title, so listing it again reads redundant.
    var all=(m.checks||[]).filter(function(c){return c!==m.pattern;});
    var li=function(c){return '<div class="mt-li"><span class="d">&mdash;</span>'+esc(c)+'</div>';};
    // Collapse a long list to the first 2 lines with a CSS-only "See more" toggle (no JS state — the card is set once
    // per completed ask, so a checkbox-hack survives). id keyed on run.id so multiple cards don't share a toggle.
    var LIMIT=2, checksBlock='';
    if(all.length){
      if(all.length<=LIMIT){
        checksBlock='<div class="mt-block"><span class="mt-k">a full scan would auto-check:</span>'+all.map(li).join('')+'</div>';
      } else {
        var id='rc-'+esc(run.id);
        checksBlock='<div class="mt-block"><span class="mt-k">a full scan would auto-check:</span>'
          +'<input type="checkbox" id="'+id+'" class="rc-tgl" hidden>'
          +all.slice(0,LIMIT).map(li).join('')
          +'<span class="rc-rest">'+all.slice(LIMIT).map(li).join('')+'</span>'
          +'<label for="'+id+'" class="rc-more rc-show">See more ('+(all.length-LIMIT)+') &#9662;</label>'
          +'<label for="'+id+'" class="rc-more rc-hide">See less &#9652;</label>'
        +'</div>';
      }
    }
    return '<div class="rd-card flush"><div class="rd-sec-head"><h3>Pattern recognized</h3><span class="eyebrow">memory</span></div>'   // UI-17: distinct from the "Written to memory" card beside it
      +'<div class="mem-term">'
        +'<div class="mt-h">Pattern recognized &mdash; '+esc(m.pattern)+'</div>'
        +checksBlock
        +'<div class="mt-block"><span class="mt-k">this ask:</span> <span class="mt-ro">read-only &mdash; nothing written to memory</span></div>'
      +'</div></div>';
  }
  // Quick Ask tab: after an ask finishes we HOLD the auto-jump-to-report (see the 'done' handler) so the recognized
  // pattern reads here, right under the Run log — just the Running Log + this Memory card, no Open-report button.
  function renderAskMemory(id){
    var host=document.getElementById('askMemoryCard'); if(!host) return;
    var r=runById(id);
    if(!r||!r.recognized||!r.recognized.pattern){ host.innerHTML=''; return; }
    host.innerHTML=renderRecognitionTerminal(r);
  }
  // QuickAsk memory (report folder): the lighter counterpart to renderMemoryReceipt. A read-only ask writes nothing
  // to the ledger, so there are NO save counts and NO confirm-green — instead a "Run full scan" nudge (reuses the
  // newrun action) toward the run that DOES save the method. Empty when the ask matched no pattern.
  function renderRecognitionCard(r){
    var m=r&&r.recognized; if(!m||!m.pattern) return '';
    var sig=(m.signature||[]).map(function(s){return '<span class="mem-pill">'+esc(s)+'</span>';}).join('');
    // Drop the headline pattern from the auto-check list — already the title above, so listing it again reads redundant.
    var chks=(m.checks||[]).filter(function(c){return c!==m.pattern;});
    var cli=function(c){return '<span class="rc-chk"><span class="d">&rsaquo;</span> '+esc(c)+'</span>';};
    // Show the first 2 checks; collapse the rest behind a CSS-only See more/less toggle so the list never runs off-screen.
    var LIMIT=2, checksBody='';
    if(chks.length){
      if(chks.length<=LIMIT){ checksBody=chks.map(cli).join(''); }
      else {
        var cid='reccard-'+esc(r.id);
        checksBody='<input type="checkbox" id="'+cid+'" class="rc-tgl" hidden>'
          +chks.slice(0,LIMIT).map(cli).join('')
          +'<span class="rc-rest">'+chks.slice(LIMIT).map(cli).join('')+'</span>'
          +'<label for="'+cid+'" class="rc-more rc-show">See more ('+(chks.length-LIMIT)+') &#9662;</label>'
          +'<label for="'+cid+'" class="rc-more rc-hide">See less &#9652;</label>';
      }
    }
    return '<div class="rec-card">'
      +'<div class="rec-top"><div><div class="eyebrow" style="color:var(--honey-link)">Pattern recognized</div><div class="rec-ptn">'+esc(m.pattern)+'</div></div>'
        +'<span class="rec-ro"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> read-only · nothing saved</span></div>'
      +(sig?'<div class="mem-sig">'+sig+'</div>':'')
      +(chks.length?'<div class="rec-checks"><span class="rc-lab">A full scan would auto-check</span><div class="rc-list">'+checksBody+'</div></div>':'')
      +'<div class="rec-foot"><span class="rec-note">A full scan confirms these and can save the method to memory.</span>'
        +'<button class="btn honey" data-act="newrun">Run full scan'+(r.scope?' <span style="font-weight:400;opacity:.72">&middot; '+esc(r.scope)+'</span>':'')+' &rarr;</button></div>'
      +'</div>';
  }
  // One run's FOLDER contents: every report artifact (internal + leadership + each area report), each with Open.
  function renderReportFolder(lst, r){
    var arts=runReportArtifacts(r);
    // Run date with its time zone (e.g. "Jul 1, 2026, 10:46 AM PDT").
    var when=r.createdAt?(function(){try{return new Date(r.createdAt).toLocaleString(UI_LOCALE,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}catch(e){return '';}})():'';
    var head='<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px">'
      +'<button class="btn ghost" data-act="report-folder-back" style="font-size:12.5px;padding:5px 11px;margin-right:auto">← All runs</button>'
      +'<div style="text-align:right">'
        +'<div style="font-size:10.5px;color:var(--honey-link);text-transform:uppercase;letter-spacing:.12em">'+esc(runTitle(r))+' · '+arts.length+' report'+(arts.length===1?'':'s')+'</div>'
        +(when?'<div class="mono" style="font-size:11px;color:var(--muted);margin-top:3px">Run · '+esc(when)+'</div>':'')
      +'</div></div>';
    // The user's original question / primary answer context reads FIRST, then the artifact list.
    var qCard=reportQuestionCard(r);
    var artsLabel='<div style="font-size:10.5px;color:var(--honey-link);text-transform:uppercase;letter-spacing:.12em;margin-bottom:9px">Generated reports · '+arts.length+'</div>';
    var reportsOpen=!!state.folderReportsOpen; var COLLAPSE=2;   // generated-reports list: first 2, then "See more"
    var shown=(arts.length>COLLAPSE&&!reportsOpen)?arts.slice(0,COLLAPSE):arts;
    var cards=shown.map(function(a){
      var openAttr=a.kind==='bundle'
        ? 'data-act="report-open-art" data-id="'+esc(r.id)+'" data-artkind="bundle" data-bundle="'+esc(a.bundleId)+'"'
        : 'data-act="report-open-art" data-id="'+esc(r.id)+'" data-artkind="'+esc(a.kind)+'"';
      return '<div class="report-art-card">'
        +'<span class="report-art-icon">▦</span>'
        +'<div style="flex:1;min-width:0"><div style="font-size:14.5px;font-weight:600">'+esc(a.label)+'</div>'
        +'<div class="mono" style="font-size:11px;color:var(--muted);margin-top:2px">'+esc(a.sub)+'</div></div>'
        +'<div style="display:flex;gap:6px;white-space:nowrap;align-items:center">'
        +'<button class="btn ghost" '+openAttr+' style="font-size:12.5px;padding:5px 11px;color:var(--num);font-weight:600">Open →</button></div></div>';
    }).join('');
    var moreBtn=arts.length>COLLAPSE?'<button class="rd-brief-more" data-act="toggle-folder-reports" style="margin:2px 0 4px">'+(reportsOpen?'See less':'See more ('+(arts.length-COLLAPSE)+')')+'</button>':'';
    // Full-scan runs carry r.learned → renderMemoryReceipt; QuickAsk runs carry r.recognized → renderRecognitionCard.
    // Each gates on its own field, so appending both is safe: only the matching one renders for a given run.
    lst.innerHTML=head+qCard+artsLabel+cards+moreBtn+renderMemoryReceipt(r)+renderRecognitionCard(r);
  }
  // The Internal | Leadership toggle: shown once a report is open; the Leadership tab only when the run
  // actually produced one (run.leadership from /api/state).
  function renderReportToggle(){
    var t=document.getElementById('reportToggle'); if(!t) return;
    var run=state.reportRunId?runById(state.reportRunId):null;
    if(!run){ t.style.display='none'; t.innerHTML=''; return; }
    t.style.display='flex';
    // ONE reader bar for every kind — back + kind pill + title + which report + id·time + "Open in new tab" (the
    // report route URL, so browser find / print work on the bare document). The view switch lives in the rail.
    var back='<button data-act="report-back" style="margin-right:auto">← All reports</button>';
    var kindLbl='';
    if(state.reportKind==='bundle'){ var br=(run.bundleReports||[]).filter(function(b){return b.id===state.reportBundleId;})[0]; kindLbl=br?('Area report · '+bundleDisplayName(br.id,br.title)):'Area report'; }
    else if(state.reportKind==='combined') kindLbl='Combined report';
    else if(state.reportKind==='provenance') kindLbl='Design & Evolution';
    else if(state.reportKind==='leadership') kindLbl='Leadership report';
    else if(state.reportKind==='workitems') kindLbl='Work items';
    else kindLbl=internalReportLabel(run);
    var when=runWhen(run);
    var src=reportFrameSrc(run.id,state.reportKind,state.reportBundleId);
    t.innerHTML=back
      +'<span class="rt-pill">'+(run.kind==='ask'?'QUICK ASK':(run.kind==='audit'?'REC AUDIT (LEGACY)':(run.kind==='design'?'DESIGN DOC (LEGACY)':'FULL SCAN')))+'</span>'
      +'<span class="rt-title" title="'+esc(runTitleBare(run))+'">'+esc(runTitleBare(run))+'</span>'   // the kind is the pill right before it
      +'<span class="mono rt-kind">'+esc(kindLbl)+'</span>'
      +'<span class="rt-meta mono" title="'+esc(when||'')+'">'+esc(when||'')+'</span>'
      +'<a class="rt-newtab" href="'+esc(src)+'" target="_blank" rel="noopener" title="Open this report on its own page — browser find and print work there">Open in new tab &#8599;</a>';
  }
  // Run timestamp with its time zone, '' when there's none.
  function runWhen(r){ return r&&r.createdAt?(function(){try{return new Date(r.createdAt).toLocaleString(UI_LOCALE,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}catch(e){return '';}})():''; }
  // Reading-room report TABS (console polish — replaces the deck's left rail; the report gets the full width). One tab per
  // report that opens in the frame (reportGuide entries with frame:true — for a Full Scan: Leadership + Execution), the
  // recommended one badged "Start here", the read time as small text (the full audience line is the tooltip); the
  // deliverables that do not open in the frame (REMEDIATION.md / run trace / run audit) sit as compact links at the end.
  // Every tab opens via report-open-art (the library cards' action), which keeps ?run=&kind= in sync with the tab.
  // Hidden for a single-view Quick Ask (one answer, nothing to switch to).
  function renderReportTabs(){
    if(currentView()==='report') renderTopbar('report');   // The strip follows the OPEN report's run
    var bar=document.getElementById('reportTabs'); if(!bar) return;
    var run=state.reportRunId?runById(state.reportRunId):null;
    if(!run||(run.kind==='ask'&&!run.workItems)){ bar.style.display='none'; bar.innerHTML=''; return; }
    bar.style.display='flex';
    var guide=reportGuide(run);
    var tabs=guide.filter(function(e){ return e.frame; }).map(function(e){
      var on=state.reportKind===e.kind&&(e.kind!=='bundle'||state.reportBundleId===e.bundleId);
      var mm=/~(\d+) min/.exec(String(e.line||''));
      return '<button role="tab" '+guideOpenAttr(run,e)+' class="rtab'+(on?' on':'')+'" aria-selected="'+(on?'true':'false')+'"'+(on?' aria-current="page"':'')+' title="'+esc(e.label+' — '+e.line)+'">'
        +'<span class="rtab-nm">'+esc(e.label)+'</span>'+(mm?'<span class="rtab-min mono">~'+esc(mm[1])+' min</span>':'')+(e.recommended?'<span class="rtab-rec">Start here</span>':'')+'</button>';
    }).join('');
    var also=guide.filter(function(e){ return !e.frame; }).map(function(e){
      var tag=guideTag(e);
      return '<'+tag+' class="rtab-also" '+guideOpenAttr(run,e)+' title="'+esc(e.label+' — '+e.line)+'">'+esc(e.label)+' '+(e.kind==='remediation'?'&#8595;':'&#8599;')+'</'+tag+'>';
    }).join('');
    bar.innerHTML='<div class="rtabs-list" role="tablist" aria-label="Reports of this run">'+tabs+'</div>'+(also?'<div class="rtabs-also">'+also+'</div>':'');
  }

  // ---------- local folder browser ----------
  var browseCur='';
  function browse(p){
    var box=document.getElementById('localBrowser'); if(box)box.style.display='block';
    api('/api/local/browse?path='+encodeURIComponent(p||'')).then(function(r){return r.json();}).then(function(d){
      var list=document.getElementById('browseList');
      if(d.error){ if(list)list.innerHTML='<div style="padding:10px;color:#C0392B;font-size:13px">'+esc(d.error)+'</div>'; return; }
      browseCur=d.path; var ph=document.getElementById('browsePath'); if(ph)ph.textContent=d.path;
      var rows='';
      if(d.parent) rows+='<div class="cfg-item" data-browse="'+esc(d.parent)+'"><span class="cfg-lbl" style="color:var(--muted)">↑ ..</span></div>';
      rows+=(d.dirs||[]).map(function(e){
        return '<div class="cfg-item" data-browse="'+esc(d.path+'/'+e.name)+'"><span class="cfg-lbl">'+esc(e.name)+'</span>'+(e.isRepo?'<span class="sbadge ok" style="font-size:9.5px;padding:2px 7px">git</span>':'')+'</div>';
      }).join('');
      if(list)list.innerHTML=rows||'<div style="padding:10px;color:var(--muted);font-size:13px">(no subfolders)</div>';
    }).catch(function(){ var l=document.getElementById('browseList'); if(l)l.innerHTML='<div style="padding:10px;color:#C0392B;font-size:13px">browse failed</div>'; });
  }
  function renderLocalConnected(){
    var host=document.getElementById('localConnected'); if(!host)return;
    var src=srcByKind('local'); var arts=(src&&src.artifacts)||[];
    if(!arts.length){ host.innerHTML=''; return; }
    host.innerHTML='<div class="eyebrow" style="margin:14px 0 7px">Connected · '+arts.length+' folder'+(arts.length>1?'s':'')+'</div>'+
      arts.map(function(a){
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px;background:var(--cream-card)">'+
          '<span style="flex:1;min-width:0;overflow:hidden" title="'+esc(a.id)+'"><span style="font-size:14px;font-weight:500">'+esc(a.label)+'</span><br><span class="mono" style="font-size:11px;color:var(--muted);word-break:break-all">'+esc(localFolderSub(a))+'</span></span>'+   // Upload date + file count, the server path only in the tooltip
          '<button class="btn ghost" data-act="local-remove" data-path="'+esc(a.id)+'" data-label="'+esc(a.label||a.id)+'" style="padding:4px 10px;font-size:12.5px;white-space:nowrap;color:var(--crit)">Remove</button>'+
        '</div>';
      }).join('');
  }
  function localRemove(p,label){ if(!confirm(actionConfirmText('remove-folder',{title:label}))) return; api('/api/sources/local/remove',{method:'POST',body:{path:p}}).then(function(){ loadState(); }); }   // Destructive → confirm

  // Public-GitHub-URL source: when repos are already connected, list them (read-only) in the detail
  // panel so you can see WHAT is connected. The textarea below stays empty (it's for adding
  // more); the whole source is removed via the "Disconnect giturl" button — there's no per-repo remove.
  function renderGiturlConnected(){
    var host=document.getElementById('giturlConnected'); if(!host)return;
    var src=srcByKind('giturl'); var arts=(src&&src.artifacts)||[];
    if(!arts.length){ host.innerHTML=''; return; }
    host.innerHTML='<div class="eyebrow" style="margin:2px 0 7px">Connected · '+arts.length+' public repo'+(arts.length>1?'s':'')+'</div>'+
      arts.map(function(a){ var url='https://github.com/'+a.id;
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px;background:var(--cream-card)">'+
          '<span style="flex:1;min-width:0;overflow:hidden"><span style="font-size:14px;font-weight:500">'+esc(a.id)+'</span><br><a href="'+esc(url)+'" target="_blank" rel="noopener" class="mono" style="font-size:11px;color:var(--honey-link);word-break:break-all;text-decoration:none">'+esc(url)+'</a></span>'+
        '</div>';
      }).join('')+
      '<div class="eyebrow" style="margin:14px 0 7px">Add more</div>';
  }

  // ---------- Local code UPLOAD (browser folder picker → /api/connect/local/upload) ----------

  // Skip dependency/build dirs + binaries client-side so the payload is just source text and stays well under the cap.
  var LOCAL_SKIP_DIR=/(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.output|\.turbo|\.svelte-kit|\.parcel-cache|vendor|venv|\.venv|env|__pycache__|\.mypy_cache|\.pytest_cache|\.gradle|target|coverage|\.nyc_output|\.cache|\.idea|\.vscode|bower_components|Pods|DerivedData|\.terraform)(\/|$)/i;
  var LOCAL_SKIP_EXT=/(\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tgz|tar|rar|7z|bz2|xz|mp4|mov|avi|mkv|webm|mp3|wav|flac|ogg|woff2?|ttf|otf|eot|exe|dll|so|dylib|a|o|obj|bin|class|jar|war|wasm|pyc|pyo|xlsx?|docx?|pptx?|psd|ai|sketch|fig|node|map|db|sqlite3?|dmg|iso|mo|pack|idx|log)$|(^|\/)[^\/]*\.lock$|\.min\.(js|css)$)/i;
  var LOCAL_MAX_FILE=512*1024;        // per-file cap (512 KB) — source files are small; skip generated/huge blobs
  var LOCAL_MAX_TOTAL=25*1024*1024;   // total cap (server accepts up to ~30 MB JSON)
  function fmtBytes(n){ return n>=1048576?((n/1048576).toFixed(1)+' MB'):Math.max(1,Math.round(n/1024))+' KB'; }
  function localPicked(fileList){
    var arr=Array.prototype.slice.call(fileList||[]); var files=[], total=0, skipped=0, dropped=0, folder='';
    for(var i=0;i<arr.length;i++){ var f=arr[i]; var rel=(f.webkitRelativePath||f.name||'').replace(/\\/g,'/');
      if(!folder && rel.indexOf('/')>=0) folder=rel.split('/')[0];
      if(LOCAL_SKIP_DIR.test('/'+rel) || LOCAL_SKIP_EXT.test(rel) || f.size>LOCAL_MAX_FILE){ skipped++; continue; }
      if(total+f.size>LOCAL_MAX_TOTAL){ dropped++; continue; }
      total+=f.size; files.push(f);
    }
    state.localUploadPick={ files:files, folder:folder||'folder', total:total, skipped:skipped, dropped:dropped };
    var info=document.getElementById('localUploadInfo'), btn=document.getElementById('localUploadBtn');
    if(info){ info.style.display='block';
      info.innerHTML=files.length
        ? '<b>'+esc(state.localUploadPick.folder)+'</b> · '+files.length+' file(s) · '+fmtBytes(total)+(dropped?' · <span style="color:#B3401F">'+dropped+' skipped (over '+Math.round(LOCAL_MAX_TOTAL/1048576)+' MB cap)</span>':(skipped?' · '+skipped+' deps/binaries skipped':''))
        : '<span style="color:#B3401F">No source files found in that folder (all deps/binaries).</span>'; }
    if(btn) btn.style.display=files.length?'block':'none';
  }
  function doLocalUpload(){
    var pick=state.localUploadPick; if(!pick||!pick.files.length||state.localUploading)return;
    state.localUploading=true; var btn=document.getElementById('localUploadBtn'); if(btn){btn.disabled=true;btn.textContent='Reading files…';}
    Promise.all(pick.files.map(function(f){ return f.text().then(function(txt){ return {path:f.webkitRelativePath||f.name, content:txt}; }); })).then(function(payload){
      if(btn)btn.textContent='Uploading…';
      return api('/api/connect/local/upload',{method:'POST',body:{name:pick.folder,files:payload}});
    }).then(function(r){ return r.json().then(function(d){return{ok:r.ok,d:d};}); }).then(function(res){
      state.localUploading=false; if(btn){btn.disabled=false;btn.textContent='Upload & connect';}
      var info=document.getElementById('localUploadInfo');
      if(!res.ok){ if(info)info.innerHTML='<span style="color:#C0392B">'+esc(res.d.error||'Upload failed')+'</span>'; return; }
      state.localUploadPick=null; var fi=document.getElementById('localUpload'); if(fi)fi.value=''; if(btn)btn.style.display='none'; if(info)info.style.display='none';
      loadState();
    }).catch(function(e){ state.localUploading=false; if(btn){btn.disabled=false;btn.textContent='Upload & connect';} var info=document.getElementById('localUploadInfo'); if(info){info.style.display='block';info.innerHTML='<span style="color:#C0392B">Upload error: '+esc(String((e&&e.message)||e))+'</span>';} });
  }

  // ---------- shared log helper (Quick Ask live log) ----------
  function logLine(line,cls,boxId){ var box=document.getElementById(boxId||'log'); if(!box)return; var d=document.createElement('div'); if(cls)d.className=cls; d.innerHTML='<span class="t">['+new Date().toLocaleTimeString(UI_LOCALE)+']</span> '+esc(line); box.appendChild(d); box.scrollTop=box.scrollHeight; }
  // ---------- accel-mini ask (scoped question → free-vibe report) ----------
  // The dedicated "Ask" tab: one read-only investigate run → an English report. Streams the /events
  // SSE into #askLog; on done it opens the report. Runs persist server-side (kind:'ask') and appear under Runs.
  function askBump(line){ var l=line.toLowerCase(),idx=0;
    if(/stage:report|free-vibe|reworded|red-team|fallback|done/.test(l))idx=1; else idx=0;
    var st=document.querySelectorAll('#askPipeline .pstage'); for(var i=0;i<st.length;i++) st[i].className='pstage'+(i<idx?' done':'')+(i===idx?' active':''); }
  // A single Ask in flight locks the one Ask button; it re-enables on done / error / network-error (then re-applies
  // the key gate).
  function lockAsk(){ var b=document.getElementById('askBtn'); if(b){ b.disabled=true; b.textContent='Asking…'; } }
  function unlockAsk(){ var b=document.getElementById('askBtn'); if(b){ b.disabled=false; b.textContent='Ask →'; } renderAskGate(); }
  // The single Ask button → the ONE report path (deterministic scoped template).
  function startAsk(){
    var q=(document.getElementById('askQuestion')||{}).value||''; var scope=(document.getElementById('askScope')||{}).value||''; var fixes=!!((document.getElementById('askFixes')||{}).checked); var useMem=(document.getElementById('askUseMemory')||{checked:true}).checked; var writeMem=!!((document.getElementById('askWriteMemory')||{}).checked);
    if(!q.trim()){ logLine('type a question to ask first','err','askLog'); return; }
    if(keysMissing()){ renderAskGate(); return; }
    lockAsk();
    document.getElementById('askLog').innerHTML=''; var _mc=document.getElementById('askMemoryCard'); if(_mc) _mc.innerHTML=''; askBump('');
    var _apf=askPlaneFilters();   // The explicit per-ask plane selection (absent ⇒ none server-side)
    api('/api/ask',{method:'POST',body:{question:q,scope:scope,fixes:fixes,useMemory:useMem,writeMemory:writeMem,repos:selectedAskRepos(),localFolders:selectedAskLocal(),planeFilter:_apf.planeFilter}}).then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});}).then(function(res){
      if(!res.ok){logLine(res.d.error||'failed to start','err','askLog');if(/key/i.test(String(res.d.error||'')))loadSettings();unlockAsk();return;}
      logLine('Quick Ask started','','askLog'); askStream(res.d.id);
    }).catch(function(){logLine('network error','err','askLog');unlockAsk();});
  }
  // ---------- repo selector (folded; default repos + all repos foldable). Used by Quick Ask via a namespace
  // ns ('ask') keying state[ns+Repos/RepoSel/ReposLoaded/ReposAllOpen] + the <ns>RepoBox/Body/Count/Chev ids +
  // data-act <ns>repo / <ns>repos-all / <ns>repos-toggle. ----------
  // The connected public-URL / local-folder sources the cached list was loaded against — a change re-fetches.
  function askExtraSrcSig(){ return (state.sources||[]).filter(function(s){ return s&&(s.kind==='giturl'||s.kind==='local'); }).map(function(s){ return s.id+'|'+(s.detail||''); }).join(';'); }
  function loadRepos(ns){
    var srcSig=askExtraSrcSig();
    if(state[ns+'ReposLoaded'] && state[ns+'ReposSrcSig']===srcSig){ renderRepos(ns); return; }
    api('/api/ask/repos').then(function(r){return r.json();}).then(function(d){
      d=d||{defaults:[],all:[]};
      state[ns+'Repos']=d; state[ns+'ReposSrcSig']=srcSig;
      // A successful full list is cached (largest wins, keyed by repoOrgAllKey = the accounts enumerated): a transient
      // miss (token not yet resolved → enumerated:false or a short partial) must not strand the picker on a tiny list.
      // And only treat the load as final (cache it) when enumeration actually succeeded — otherwise leave ReposLoaded
      // unset so the next panel-open re-fetches and self-heals instead of caching a degraded list forever.
      if(d.enumerated && (d.all||[]).length){ var okey=(d.orgs||[]).slice().sort().join(','); if(state.repoOrgAllKey!==okey || !state.repoOrgAll || d.all.length>state.repoOrgAll.length){ state.repoOrgAll=d.all; state.repoOrgAllKey=okey; } }
      if(d.enumerated){ state[ns+'ReposLoaded']=true; }
      // Quick Ask scope is explicit: nothing is pre-ticked, so an ask never clones the "repos investigated to date"
      // unless you pick them.
      if(!state[ns+'RepoSel']){ state[ns+'RepoSel']={}; }
      renderRepos(ns);
    }).catch(function(){ /* selector stays on defaults server-side */ });
  }
  function repoBranches(ns){ var m={}; ((state[ns+'Repos']&&state[ns+'Repos'].defaults)||[]).forEach(function(d){ var p=String(d).split('@'); if(p[1])m[p[0]]=p[1]; }); return m; }
  function selectedRepos(ns){ var sel=state[ns+'RepoSel']||{}; var br=repoBranches(ns); return Object.keys(sel).filter(function(k){return sel[k]&&k.indexOf(ASK_LOCAL_PREFIX)!==0;}).map(function(fn){ return br[fn]?(fn+'@'+br[fn]):fn; }); }
  function selectedAskLocal(){ var sel=state.askRepoSel||{}; return askSplitSelection(Object.keys(sel).filter(function(k){return sel[k];}),state.askRepos).localFolders; }
  function repoSelCount(ns){ return selectedRepos(ns).length+(ns==='ask'?selectedAskLocal().length:0); }
  function renderRepos(ns){
    var hdrN=document.getElementById(ns+'RepoCount'); if(hdrN) hdrN.textContent=String(repoSelCount(ns));
    var box=document.getElementById(ns+'RepoBody'); if(!box) return;
    var data=state[ns+'Repos']||{defaults:[],all:[]}; var sel=state[ns+'RepoSel']||{};
    var defaults=(data.defaults||[]).map(function(d){return String(d).split('@')[0];});
    var defSet={}; defaults.forEach(function(d){defSet[d]=1;});
    function row(fn,label,sub){ return '<div data-act="'+ns+'repo" data-repo="'+esc(fn)+'"'+(label?' data-label="'+esc(label)+'"':'')+' style="display:flex;align-items:center;gap:7px;font-size:13px;padding:3px 1px;cursor:pointer"><input type="checkbox" tabindex="-1" style="pointer-events:none"'+(sel[fn]?' checked':'')+'><span class="mono" style="word-break:break-all">'+esc(label||fn)+'</span>'+(sub?'<span style="color:var(--muted);font-size:11.5px;white-space:nowrap">'+esc(sub)+'</span>':'')+'</div>'; }
    // Prefer the cached full enumeration when it's larger than this load, so a degraded/partial load still renders
    // the full list. Scoped by repoOrgAllKey (the accounts enumerated).
    var dataKey=((data.orgs)||[]).slice().sort().join(',');
    var allList=(state.repoOrgAll && state.repoOrgAllKey===dataKey && state.repoOrgAll.length>(data.all||[]).length) ? state.repoOrgAll : (data.all||[]);
    var rest=allList.map(function(r){return r.fullName;}).filter(function(fn){return !defSet[fn];});
    var q=state[ns+'RepoQuery']||'';
    var deflabel='Default · repos investigated to date';
    // Toolbar: live search across ALL repos + Select all / None (operate on the currently-shown, i.e. filtered, rows).
    var btn='background:none;border:1px solid var(--line);border-radius:6px;color:var(--honey-link);cursor:pointer;font-size:11px;padding:4px 9px;white-space:nowrap';
    var html='<div style="display:flex;gap:6px;margin-bottom:8px">'
      +'<input data-act="repo-search" data-ns="'+ns+'" value="'+esc(q)+'" placeholder="Search repos…" style="flex:1;min-width:0;font-size:12.5px;padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--espresso)">'
      +'<button type="button" data-act="'+ns+'repos-allsel" style="'+btn+'">All</button>'
      +'<button type="button" data-act="'+ns+'repos-none" style="'+btn+'">None</button></div>';
    if(defaults.length) html+='<div style="font-size:10.5px;color:var(--honey-link);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">'+deflabel+'</div>'+defaults.map(function(fn){ return row(fn); }).join('');   // polish: no empty "Default" group header
    if(rest.length){
      // The full-org rows are ALWAYS rendered (in #<ns>RepoRest) so search can reach them even when collapsed.
      html+='<div style="margin-top:9px"><button type="button" data-act="'+ns+'repos-all" style="background:none;border:none;color:var(--honey-link);cursor:pointer;font-size:12.5px;padding:2px 0">'+(state[ns+'ReposAllOpen']?'▾ Hide':'▸ Show')+' all repos · '+rest.length+' more</button></div>';
      html+='<div id="'+ns+'RepoRest" style="display:'+((state[ns+'ReposAllOpen']||q)?'block':'none')+';margin-top:4px;padding-top:5px;border-top:1px dashed var(--line)">'+rest.map(function(fn){ return row(fn); }).join('')+'</div>';
    } else if(!data.enumerated){ html+='<div style="font-size:11px;color:var(--muted);margin-top:7px">Repo list unavailable — connect GitHub (Connect tab) to browse your repos.</div>'; }
    if(ns==='ask'){
      // Connected Public GitHub URL repos + uploaded / local folders — normal rows, never pre-ticked.
      var xg=askExtraGroups(data,defaults.concat(rest));
      var grpLab='font-size:10.5px;color:var(--honey-link);text-transform:uppercase;letter-spacing:.1em;margin:11px 0 4px;padding-top:7px;border-top:1px dashed var(--line)';
      if(xg.public.length) html+='<div style="'+grpLab+'">Public GitHub URLs</div>'+xg.public.map(function(fn){ return row(fn); }).join('');
      if(xg.local.length) html+='<div style="'+grpLab+'">Uploaded folders</div>'+xg.local.map(function(f){ return row(f.key,f.label,f.sub); }).join('');
    }
    box.innerHTML=html;
    if(q) filterReposRows(ns);
    if(ns==='ask') renderAskPlanes();   // the compose scope line counts the ticked repos
  }
  // Live filter (no innerHTML rebuild → the search box keeps focus): hide non-matching rows, and reveal the
  // all-repos section while a query is active so matches there are visible even if the section is collapsed.
  function filterReposRows(ns){
    var q=(state[ns+'RepoQuery']||'').toLowerCase().trim();
    var box=document.getElementById(ns+'RepoBody'); if(!box) return;
    var restC=document.getElementById(ns+'RepoRest'); if(restC) restC.style.display=(q||state[ns+'ReposAllOpen'])?'block':'none';
    var rows=box.querySelectorAll('[data-act="'+ns+'repo"]');
    for(var i=0;i<rows.length;i++){ var fn=(rows[i].getAttribute('data-label')||rows[i].getAttribute('data-repo')||'').toLowerCase(); rows[i].style.display=(!q||fn.indexOf(q)>=0)?'flex':'none'; }
  }
  function toggleReposPanel(ns){ var b=document.getElementById(ns+'RepoBody'); var c=document.getElementById(ns+'RepoChev'); if(!b)return; var open=b.style.display==='none'; b.style.display=open?'block':'none'; if(c)c.textContent=open?'▾':'▸'; if(open)renderRepos(ns); }
  function loadAskRepos(){ loadRepos('ask'); }          // back-compat: Ask call sites
  function selectedAskRepos(){ return selectedRepos('ask'); }
  function askStream(id){ var es=new EventSource('/api/runs/'+id+'/events');
    es.addEventListener('log',function(e){ logLine(e.data,'','askLog'); askBump(e.data); });
    // Hold the auto-jump-to-report so the just-recognized memory card reads HERE, under the Terminal, on the Quick
    // Ask tab. Refresh state first (so run.recognized is loaded), then render the card; an Open-report button on the
    // card lets the user jump when they want. Stopped runs skip the card.
    es.addEventListener('done',function(e){ var d={}; try{d=JSON.parse(e.data);}catch(_){}; es.close(); unlockAsk(); if(d.stopped){ logLine('stopped','','askLog'); } else { askBump('done'); logLine('done'+(d.costUsd!=null?(' · $'+d.costUsd):''),'','askLog'); } loadState().then(function(){ if(!d.stopped) renderAskMemory(id); }); });
    es.addEventListener('error',function(e){ var m='stream error'; try{if(e.data)m=JSON.parse(e.data).error||m;}catch(_){}; logLine(m,'err','askLog'); es.close(); unlockAsk(); loadState(); });
  }
  // Quick Ask always invokes Claude → gate the Ask button until an Anthropic key is set (Settings).
  function renderAskGate(){ var need=keysMissing();
    var b=document.getElementById('askBtn'); if(b&&b.textContent!=='Asking…')b.disabled=need;
    var h=document.getElementById('askByoHint'); if(h)h.style.display=need?'block':'none';
    var cl=document.getElementById('askCapLine'); if(cl) cl.innerHTML=capLineHtml(); }

  // ---------- events ----------
  document.addEventListener('input',function(e){ var t=e.target; if(t&&t.getAttribute&&t.getAttribute('data-act')==='repo-search'){ var ns=t.getAttribute('data-ns'); if(ns){ state[ns+'RepoQuery']=t.value; filterReposRows(ns); } } });
  document.addEventListener('input',function(e){ var t=e.target; if(t&&t.getAttribute&&t.getAttribute('data-act')==='src-search'){ state.srcQuery=t.value||''; filterSrcRows(); } });
  // Memory → Compare search (console polish): re-render only #cmpResults so the box keeps focus; Esc clears the filter
  // (captured before the global Esc handlers, and only while there is something to clear).
  function cmpPaintResults(){ var h=document.getElementById('cmpResults'); if(h&&state.memCmp) h.innerHTML=compareResultsHtml(state.memCmp,state.memCmpQ||''); }
  document.addEventListener('input',function(e){ var t=e.target; if(t&&t.id==='cmpSearch'){ state.memCmpQ=t.value||''; cmpPaintResults(); } });
  document.addEventListener('keydown',function(e){ var t=e.target; if(e.key==='Escape'&&t&&t.id==='cmpSearch'&&t.value){ e.preventDefault(); e.stopPropagation(); t.value=''; state.memCmpQ=''; cmpPaintResults(); } },true);
  document.addEventListener('input',function(e){ var t=e.target; if(t&&t.id==='engagementBrief'){ state.briefText=t.value; ensureBaselineInfo(); if(state.baselineInfo&&state.baselineInfo.loading) paintBaseline(); } });   // The brief is a compared input
  document.addEventListener('change',function(e){ if(e.target&&e.target.id==='localUpload') localPicked(e.target.files);
    if(e.target&&e.target.id==='orgCodeintel') state.orgCodeintel=e.target.checked;   // persist per-run toggle across config re-renders (rendered checked-from-state)
    if(e.target&&e.target.id==='orgMemoryRecall'){ state.memRecall=e.target.checked; saveCfgText(); state.scanConfirm=false; renderRunDetail(); }
    if(e.target&&e.target.id==='orgSiblingRecall'){ state.siblingRecall=e.target.checked; saveCfgText(); renderRunDetail(); }
    if(e.target&&e.target.id==='orgWriteMemory'){ state.orgWriteMemory=e.target.checked; saveCfgText(); renderRunDetail(); }   // re-render: the summary line states it
    if(e.target&&(e.target.id==='askWriteMemory'||e.target.id==='askUseMemory')) paintAskScopeLine();
    if(e.target&&e.target.id==='setTelemetryOn'){ setTelemetry({enabled:!!e.target.checked}); }
    if(e.target&&e.target.id==='setRememberConn'){ setConnections(!!e.target.checked); }
    if(e.target&&(e.target.id==='setSaveKeys'||e.target.id==='frSaveKeys')){ state.saveKeys=!!e.target.checked; }
  });

  // An open source dropdown closes on any click outside it (it used to stay open over the bundle radios).
  // Capture phase, so the click that closes it still reaches its own target (e.g. opening another source's chip).
  // DOM-only close (no re-render), so the outside click itself — a native checkbox, a radio — is not disturbed.
  function closeSrcDropdown(refocus){
    if(!state.openSrc) return; var sid=state.openSrc; state.openSrc=null; state.srcQuery='';
    var pops=document.querySelectorAll('.cfg-srcdd-panel,.cfg-srcdd-pop'); for(var i=0;i<pops.length;i++){ if(pops[i].parentNode) pops[i].parentNode.removeChild(pops[i]); }
    var chip=document.querySelector('[data-act="src-dd"][data-src="'+cssq(sid)+'"]');
    if(chip){ chip.setAttribute('aria-expanded','false'); var cr=chip.querySelector('.cfg-caret'); if(cr) cr.textContent='▸'; if(refocus){ try{ chip.focus(); }catch(_){} } }
  }
  document.addEventListener('click',function(e){
    if(!state.openSrc) return; var el=e.target;
    // The popover renders IN FLOW below the chip row, i.e. OUTSIDE .cfg-srcdd — a click on one of its rows is
    // an inside click, not an outside one (treating it as outside closed the list after every tick and dropped focus).
    if(el&&el.closest&&(el.closest('.cfg-srcdd')||el.closest('.cfg-srcdd-pop'))) return;
    closeSrcDropdown(false);
  },true);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&state.openSrc){ e.stopPropagation(); closeSrcDropdown(true); } },true);
  // The config form's ARIA checkboxes / radios / buttons (role + tabindex=0 divs) activate on Space / Enter like
  // native controls, and focus returns to the same control after the re-render the click triggers.
  document.addEventListener('keydown',function(e){
    var t=e.target; if(!t||!t.getAttribute) return;
    var role=t.getAttribute('role'); if(role!=='checkbox'&&role!=='radio'&&role!=='button') return;
    var tag=(t.tagName||'').toLowerCase(); if(tag==='button'||tag==='input'||tag==='a'||tag==='textarea'||tag==='select') return;
    if(e.key!==' '&&e.key!=='Enter'&&e.key!=='Spacebar') return;
    e.preventDefault();
    var sel=cfgFocusSelector(t);
    t.click();
    if(sel){ var again=document.querySelector(sel); if(again&&again.focus){ try{ again.focus(); }catch(_){} } }
  });
  function cfgFocusSelector(t){
    var attrs=['data-art','data-bpick','data-node'];
    for(var i=0;i<attrs.length;i++){ var v=t.getAttribute(attrs[i]); if(v!=null){ var b=t.getAttribute('data-bundle'); return '['+attrs[i]+'="'+cssq(v)+'"]'+(b!=null?'[data-bundle="'+cssq(b)+'"]':''); } }
    var act=t.getAttribute('data-act'); if(!act) return null;
    var extra=t.getAttribute('data-src')!=null?'[data-src="'+cssq(t.getAttribute('data-src'))+'"]':(t.getAttribute('data-id')!=null?'[data-id="'+cssq(t.getAttribute('data-id'))+'"]':'');
    return '[data-act="'+cssq(act)+'"]'+extra;
  }
  function cssq(v){ return String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"'); }
  // Keep the config form's typed text (brief + scope label) across the re-render every toggle triggers.
  function saveCfgText(){ var b=document.getElementById('engagementBrief'); if(b) state.briefText=b.value; var sc=document.getElementById('cfgScope'); if(sc) state.scopeText=sc.value; }
  document.addEventListener('click',function(e){ var t=e.target;
    // Backdrop click (only fires when the click lands on the dim area, not the card) → close.
    if(t&&t.id==='nodeModal'){ closeNodeModal(); return; }
    if(t&&t.id==='memDialog'){ closeMemDialog(); return; }       // backdrop click dismisses the high-risk save dialog (keeps the edit form)
    while(t&&t!==document.body
      &&!t.getAttribute('data-act')&&!t.getAttribute('data-go')&&!t.getAttribute('data-pick')&&!t.getAttribute('data-art')
      &&!t.getAttribute('data-run')&&!t.getAttribute('data-run-filter')&&!t.getAttribute('data-ask-run')&&!t.getAttribute('data-ask-filter')&&!t.getAttribute('data-node')&&!t.getAttribute('data-run-stage')&&!t.getAttribute('data-art-kind')&&!t.getAttribute('data-run-artifact')&&!t.getAttribute('data-run-event')
      &&!t.getAttribute('data-browse')&&!t.getAttribute('data-inv')&&!t.getAttribute('data-bpick')&&!t.getAttribute('data-rk')&&!t.getAttribute('data-mem-filter')&&!t.getAttribute('data-mem-id')&&!t.getAttribute('data-event-id')&&!t.getAttribute('data-mem-edit')&&!t.getAttribute('data-mem-field')&&!t.getAttribute('data-view')&&!t.getAttribute('data-run-id')
      &&!t.classList.contains('openrep')&&!t.classList.contains('openlead')&&!t.classList.contains('openbundle')&&!t.classList.contains('opencombined'))t=t.parentNode;
    if(!t||t===document.body)return;
    if(t.getAttribute('data-run')){selectRunDetail(t.getAttribute('data-run'),true);return;}
    if(t.getAttribute('data-run-filter')){state.runFilter=t.getAttribute('data-run-filter');var fs=document.querySelectorAll('[data-run-filter]');for(var fi=0;fi<fs.length;fi++)fs[fi].className='run-filter'+(fs[fi]===t?' active':'');renderRunList();return;}
    if(t.getAttribute('data-ask-filter')){state.askRunFilter=t.getAttribute('data-ask-filter');var afs=document.querySelectorAll('[data-ask-filter]');for(var afi=0;afi<afs.length;afi++)afs[afi].className='run-filter'+(afs[afi]===t?' active':'');renderAskRunList();return;}
    if(t.getAttribute('data-ask-run')){var _aid=t.getAttribute('data-ask-run');state.askDetailId=_aid;state.askComposing=false;state.activeRunId=_aid;attachDetailStream(_aid);renderAskRunList();renderAskRunDetail();return;}   // activeRunId+attach: replay/tail this ask's log into the ONE stream buffer the detail renders from
    // Graph node click → pop the detail modal up over the graph (graph stays full-width).
    if(t.getAttribute('data-node')){openNodeModal(t.getAttribute('data-node'),t.getAttribute('data-bundle')||null);return;}
    if(t.getAttribute('data-run-stage')){state.detailStage=t.getAttribute('data-run-stage');state.stagePinned=true;renderRunDetail();return;}
    if(t.getAttribute('data-art-kind')){state.artifactKind=t.getAttribute('data-art-kind');state.artifactIndex=0;renderRunDetail();return;}
    if(t.getAttribute('data-run-artifact')){state.artifactIndex=Number(t.getAttribute('data-run-artifact'))||0;renderRunDetail();return;}
    if(t.getAttribute('data-run-event')){var ev=state.detailEvents[Number(t.getAttribute('data-run-event'))];if(ev){state.detailStage=ev.stage;state.stagePinned=true;renderRunDetail();}return;}
    if(t.getAttribute('data-go')){ var _go=t.getAttribute('data-go'); if(_go==='report'){ state.reportRunId=null; state.reportKind=null; state.reportFolderRun=null; state.editingTitleRunId=null; } if(_go==='run'||_go==='ask'){ state.configOpen=false; state.askComposing=false; } go(_go); return; }   // clicking the Report NAV always returns to the all-reports list
    if(t.getAttribute('data-pick')){selectSource(t.getAttribute('data-pick'));openConnPanel();return;}
    if(t.getAttribute('data-art')){var k=t.getAttribute('data-art');var _bt=document.getElementById('engagementBrief');if(_bt)state.briefText=_bt.value;var _sc=document.getElementById('cfgScope');if(_sc)state.scopeText=_sc.value;state.artSel[k]=(state.artSel[k]===false);state.scanConfirm=false;renderRunDetail();return;}
    if(t.getAttribute('data-browse')){browse(t.getAttribute('data-browse'));return;}
    if(t.getAttribute('data-inv')){var ik=t.getAttribute('data-inv');state.invSel[ik]=(state.invSel[ik]===false);var _bti=document.getElementById('engagementBrief');if(_bti)state.briefText=_bti.value;renderRunDetail();return;}
    if(t.getAttribute('data-bpick')){if(!state.overrideBundles)return;var bpk=t.getAttribute('data-bpick');state.bundleSel[bpk]=!(state.bundleSel[bpk]===true);state.scanConfirm=false;var _btp=document.getElementById('engagementBrief');if(_btp)state.briefText=_btp.value;var _scp=document.getElementById('cfgScope');if(_scp)state.scopeText=_scp.value;renderRunDetail();return;}
    if(t.classList.contains('openrep')){openReport(t.getAttribute('data-id'));return;}
    if(t.classList.contains('openlead')){openLeadership(t.getAttribute('data-id'));return;}
    if(t.classList.contains('opencombined')){openCombined(t.getAttribute('data-id'));return;}
    if(t.classList.contains('openbundle')){openBundleReport(t.getAttribute('data-id'),t.getAttribute('data-bundle'));return;}
    if(t.getAttribute('data-rk')){showReport(t.getAttribute('data-id'),t.getAttribute('data-rk'));return;}
    var a=t.getAttribute('data-act');
    if(a==='go-settings'){ e.preventDefault(); closeChooser(); go('settings'); }
    else if(a==='keys-save'){ saveKeys(t.getAttribute('data-prefix')||'set'); }
    else if(a==='key-clear'){ var _kw=t.getAttribute('data-key'); if(_kw&&confirm('Clear the '+(_kw==='openai'?'OpenAI':'Anthropic')+' key?'+(_kw==='anthropic'?' Quick Ask and Full Scan stop working until a new key is set.':''))) saveKeys(t.getAttribute('data-prefix')||'set',_kw); }
    else if(a==='budget-save'){ saveBudget(); }
    else if(a==='telemetry-ok'){ setTelemetry({noticeShown:true}); }
    else if(a==='telemetry-off'){ setTelemetry({enabled:false,noticeShown:true}); }
    else if(a==='disconnect'){ if(!confirm('Disconnect '+(t.getAttribute('data-name')||'this source')+'? You can reconnect anytime.'))return; var pk=state.pick; api('/api/sources/disconnect',{method:'POST',body:{id:t.getAttribute('data-id')}}).then(function(){loadState().then(function(){ if(state.pick===pk && pk!=='mcp')selectSource(pk); });}); }
    else if(a==='newchoose'){ openChooser(); }
    else if(a==='choose-close'){ closeChooser(); }
    else if(a==='choose-ask'){ closeChooser(); state.askDetailId=null; state.askComposing=true; state.askPlaneSel={}; go('ask'); renderAskRunList(); renderAskRunDetail(); var _aq=document.getElementById('askQuestion'); if(_aq){ _aq.value=''; try{ _aq.focus(); }catch(_){} } var _acs=document.getElementById('askScope'); if(_acs) _acs.value=''; }   // fresh Quick Ask: open a blank compose (question + scope cleared)
    else if(a==='choose-scan'){ closeChooser(); state.briefText=''; state.configOpen=true; state.runError=''; state.scanConfirm=false; state.targetFilter=''; go('run'); renderRunDetail(); }   // a fresh compose starts with a blank brief
    else if(a==='new-ask'){ state.askDetailId=null; state.askComposing=true; state.askPlaneSel={}; renderAskRunList(); renderAskRunDetail(); var _naq=document.getElementById('askQuestion'); if(_naq){ _naq.value=''; try{ _naq.focus(); }catch(_){} } var _nas=document.getElementById('askScope'); if(_nas) _nas.value=''; }
    else if(a==='newrun'){ state.briefText=''; state.configOpen=true; state.runError=''; state.scanConfirm=false; state.targetFilter=''; go('run'); renderRunDetail(); }   // a fresh compose starts with a blank brief
    else if(a==='close-modal'){ closeNodeModal(); }
    else if(a==='close-conn'){ closeConnPanel(); }
    else if(a==='cancel-config'){ state.configOpen=false; state.runError=''; renderRunDetail(); }
    else if(a==='export-md'){ exportRemediation(t.getAttribute('data-id')||undefined); }
    else if(a==='toggle-brief'){ state.briefOpen=!state.briefOpen; renderRunDetail(); }
    else if(a==='toggle-folder-brief'){ state.folderBriefOpen=!state.folderBriefOpen; renderReportList(); }
    else if(a==='toggle-folder-reports'){ state.folderReportsOpen=!state.folderReportsOpen; renderReportList(); }
    else if(a==='toggle-mem-checks'){ state.memChecksOpen=!state.memChecksOpen; renderRunDetail(); }
    else if(a==='mem-view'){ var mvv=t.getAttribute('data-view'); if(mvv){ state.memView=mvv; renderMemory(); } }
    else if(a==='mem-cmp-kind'){ state.memCmpKind=t.getAttribute('data-view')||''; state.memCmp=null; renderMemory(); }
    else if(a==='mem-draft'){ if(state.memDraftBusy)return; var mdEl=document.getElementById('memDraftText'); var mdVal=mdEl?String(mdEl.value||'').trim():''; if(!mdVal)return;
      state.memDraftBusy=true; state.memDraftResult=null; renderMemory();
      api('/api/memory/draft',{method:'POST',body:{text:mdVal}}).then(function(r){return r.json();}).then(function(d){
        state.memDraftResult=d||{}; state.memDraftBusy=false;
        // Clear the browse + history caches so Cards/History re-fetch and reflect the new writes.
        state.mem=null; state.memHistory=null; renderMemory();
      }).catch(function(){ state.memDraftResult={error:'Draft failed'}; state.memDraftBusy=false; renderMemory(); });
    }
    // Report-tab per-card "Extract memory": intake THIS report through the memory spine, then refresh the
    // Report list (busy flag → outcome) and drop the Memory caches so the Memory tab re-fetches. FAIL-OPEN.
    else if(a==='mem-extract-report'){ var mrid=t.getAttribute('data-run-id'); if(!mrid)return; if((state.memExtractBusy||{})[mrid])return;
      state.memExtractBusy[mrid]=true; delete state.memExtractResult[mrid]; renderReportList();
      api('/api/memory/extract-from-report',{method:'POST',body:{run_id:mrid}}).then(function(r){return r.json();}).then(function(d){
        state.memExtractResult[mrid]=d||{}; delete state.memExtractBusy[mrid];
        // Clear the browse + history caches so the Memory tab re-fetches and reflects the new writes.
        state.mem=null; state.memHistory=null; renderReportList();
      }).catch(function(){ state.memExtractResult[mrid]={error:'extract failed'}; delete state.memExtractBusy[mrid]; renderReportList(); });
    }
    else if(a==='mem-filter'){ state.memFilter=t.getAttribute('data-mem-filter')||'all'; renderMemory(); }
    else if(a==='mem-expand'){ var mid=t.getAttribute('data-mem-id'); if(mid){ state.memExpanded[mid]=!state.memExpanded[mid]; renderMemory(); } }
    // History row → expand to the SAME full card the Cards tab shows (shared state.memExpanded/state.memFull);
    // ensureMemFull lazily fetches it, then memFullDetailHtml renders it with the existing Edit/Delete buttons.
    else if(a==='mem-hist-expand'){ var hid=t.getAttribute('data-mem-id'); if(hid){ state.memExpanded[hid]=!state.memExpanded[hid]; if(state.memExpanded[hid]) ensureMemFull(hid); renderMemory(); } }
    // History Revert: restore the pre-change card state this event captured, then drop the Memory caches so
    // Cards + History re-fetch. Own data-act (resolved by the closest-walk) so it never toggles mem-hist-expand.
    else if(a==='mem-revert'){ if(!memCanWrite)return; var eid=t.getAttribute('data-event-id'); if(eid){ api('/api/memory/revert',{method:'POST',body:{event_id:eid}}).then(function(r){return r.json();}).then(function(){ state.mem=null; state.memHistory=null; state.memFull={}; renderMemory(); }).catch(function(){}); } }
    else if(a==='mem-edit'){ if(!memCanWrite)return; var eid=t.getAttribute('data-mem-id'); if(eid){ state.memEdit[eid]=memEditDraft(eid); renderMemory(); } }
    else if(a==='mem-cancel'){ var cid=t.getAttribute('data-mem-id'); if(cid){ delete state.memEdit[cid]; renderMemory(); } }
    else if(a==='mem-save'){ if(!memCanWrite)return; var sid=t.getAttribute('data-mem-id'); if(sid){ openMemSaveDialog(sid); } }
    else if(a==='mem-save-confirm'){ if(!memCanWrite)return; memSaveConfirm(); }
    else if(a==='mem-delete'){ if(!memCanWrite)return; var did=t.getAttribute('data-mem-id'); if(did){ openMemDeleteDialog(did); } }
    else if(a==='mem-delete-confirm'){ if(!memCanWrite)return; memDeleteConfirm(); }
    else if(a==='mem-dialog-cancel'){ closeMemDialog(); }
    else if(a==='ctxaction'){ var cv=currentView(); if(cv==='connect'||cv==='run'){ state.configOpen=true; state.targetFilter=''; go('run'); renderRunDetail(); } else if(cv==='report'){ backToAllReports(); } }   // The report topbar action navigates back to the all-reports list
    else if(a==='theme'){ var _ts=t.getAttribute('data-set'); if(t.classList.contains('on')&&window.matchMedia&&window.matchMedia('(max-width:420px)').matches){ var _cyc={auto:'light',light:'dark',dark:'auto'}; _ts=_cyc[_ts]||'auto'; } setTheme(_ts); }   // On a phone only the ACTIVE segment is shown — tapping it cycles Auto → Light → Dark
    else if(a==='addconn')addConnection();
    else if(a==='startrun')startRun();
    else if(a==='startrun-confirm')startRun(true);   // the confirm step → actually start
    else if(a==='startrun-back'){ saveCfgText(); state.scanConfirm=false; renderRunDetail(); var _sb=document.getElementById('startBtn'); if(_sb){ try{ _sb.focus(); }catch(_){} } }
    else if(a==='toggle-hide-tools'){ state.hideToolEvents=!state.hideToolEvents; try{ window.localStorage.setItem('theresa.hideToolEvents',state.hideToolEvents?'1':'0'); }catch(_){} renderRunDetail(); renderAskRunDetail(); }   // UI-10
    else if(a==='askplane-pick'){ var _am=state.askPlaneSel; var _aid2=t.getAttribute('data-id'); _am[_aid2]=!(_am[_aid2]===true); renderAskPlanes(); }
    else if(a==='plane-pick'){ saveCfgText(); state.scanConfirm=false; var _pm=state.planeSel; var _pid=t.getAttribute('data-id'); _pm[_pid]=!(_pm[_pid]===true); renderRunDetail(); }
    else if(a==='open-resume'){ var rrid=t.getAttribute('data-id')||state.activeRunId; if(rrid&&rrid!==state.activeRunId&&runById(rrid)) selectRunDetail(rrid,true); state.resumeOpen={runId:rrid,ckpt:t.getAttribute('data-ck')||null,reuse:{},reuseFor:null}; state.resumeError=''; loadCkInfo(rrid); renderRunDetail(); }
    else if(a==='resume-cancel'){ state.resumeOpen=null; state.resumeError=''; renderRunDetail(); }
    else if(a==='resume-retry'){ var rrun=state.resumeOpen&&state.resumeOpen.runId; if(rrun){ delete state.ckInfo[rrun]; renderRunDetail(); } }
    else if(a==='resume-pick'){ if(state.resumeOpen){ state.resumeOpen.ckpt=t.getAttribute('data-ck'); renderRunDetail(); } }
    else if(a==='resume-toggle'){ if(state.resumeOpen){ var rtb=t.getAttribute('data-b'); state.resumeOpen.reuse[rtb]=state.resumeOpen.reuse[rtb]===false; renderRunDetail(); } }
    else if(a==='resume-go'){ resumeGo(); }
    else if(a==='mem-open-run'){ var mrun=t.getAttribute('data-id'); if(mrun&&runById(mrun)&&!(e.metaKey||e.ctrlKey||e.shiftKey)){ e.preventDefault(); history.pushState(null,'','/run?run='+encodeURIComponent(mrun)); closeConnPanel(true); applyView('run'); } }   // UI-16: in-app nav to the run (an unknown id falls through to the href)
    else if(a==='goto-run'){ var grid=t.getAttribute('data-id'); if(grid&&runById(grid)) selectRunDetail(grid,true); }
    else if(a==='copy-run-link'){ var r=activeRun(); if(r){ var link=location.origin+'/run?run='+encodeURIComponent(r.id); copyText(link); t.textContent='Copied'; setTimeout(function(){t.textContent='Copy app link';},1100); } }
    else if(a==='artall'){ var keys=allArtifactKeys(); var nSel=keys.filter(function(k){return state.artSel[k]!==false;}).length; var allOn=(nSel===keys.length&&keys.length); var _bt2=document.getElementById('engagementBrief'); if(_bt2)state.briefText=_bt2.value; keys.forEach(function(k){state.artSel[k]=!allOn;}); renderRunDetail(); }
    else if(a==='invall'){ var iv=window.__INV__||[]; var nOn=iv.filter(function(i){return state.invSel[i.key]!==false;}).length; var allInv=(nOn===iv.length); var _bt5=document.getElementById('engagementBrief'); if(_bt5)state.briefText=_bt5.value; iv.forEach(function(i){state.invSel[i.key]=!allInv;}); renderRunDetail(); }
    else if(a==='bundleclear'){ var _bt6=document.getElementById('engagementBrief'); if(_bt6)state.briefText=_bt6.value; state.bundleSel={}; renderRunDetail(); }
    else if(a==='override-bundles'){ var _bt7=document.getElementById('engagementBrief'); if(_bt7)state.briefText=_bt7.value; state.overrideBundles=!state.overrideBundles; renderRunDetail(); }
    else if(a==='full-rescan'){ state.fullRescan=!state.fullRescan; paintBaseline(); }
    else if(a==='bundles-auto'){ var _bta=document.getElementById('engagementBrief'); if(_bta)state.briefText=_bta.value; var _sca=document.getElementById('cfgScope'); if(_sca)state.scopeText=_sca.value; state.overrideBundles=false; state.scanConfirm=false; renderRunDetail(); }
    else if(a==='bundles-all'){ if(!state.overrideBundles) return; saveCfgText(); var _allOn=BUNDLES.every(function(b){ return state.bundleSel[b.key]===true; }); BUNDLES.forEach(function(b){ state.bundleSel[b.key]=!_allOn; }); state.scanConfirm=false; renderRunDetail(); }   // UI-19
    else if(a==='bundles-manual'){ var _btm=document.getElementById('engagementBrief'); if(_btm)state.briefText=_btm.value; var _scm=document.getElementById('cfgScope'); if(_scm)state.scopeText=_scm.value; state.overrideBundles=true; state.scanConfirm=false; renderRunDetail(); }
    else if(a==='src-dd'){ var _bts=document.getElementById('engagementBrief'); if(_bts)state.briefText=_bts.value; var _scs=document.getElementById('cfgScope'); if(_scs)state.scopeText=_scs.value; var sdk=t.getAttribute('data-src'); state.openSrc=(state.openSrc===sdk?null:sdk); state.srcQuery=''; renderRunDetail(); }
    else if(a==='src-all'){ var _bta3=document.getElementById('engagementBrief'); if(_bta3)state.briefText=_bta3.value; var _sca3=document.getElementById('cfgScope'); if(_sca3)state.scopeText=_sca3.value; var sak=t.getAttribute('data-src'); var _src=null; for(var _si=0;_si<state.sources.length;_si++){ if(state.sources[_si].id===sak){ _src=state.sources[_si]; break; } } if(_src){ var _sa=_src.artifacts||[]; var _sn=_sa.filter(function(a2){return state.artSel[_src.id+'::'+a2.id]!==false;}).length; var _allOn=(_sn===_sa.length&&_sa.length); _sa.forEach(function(a2){ state.artSel[_src.id+'::'+a2.id]=!_allOn; }); } state.scanConfirm=false; renderRunDetail(); }
    else if(a==='browse')browse((document.getElementById('localPath')||{}).value||'');
    else if(a==='browse-use'){ var lp=document.getElementById('localPath'); if(lp)lp.value=browseCur; var bb=document.getElementById('localBrowser'); if(bb)bb.style.display='none'; }
    else if(a==='pick-folder'){ var fu=document.getElementById('localUpload'); if(fu)fu.click(); }
    else if(a==='local-upload'){ doLocalUpload(); }
    else if(a==='ask-detail-close'){ state.askDetailId=null; state.askComposing=false; renderAskRunList(); renderAskRunDetail(); }
    else if(a==='local-remove')localRemove(t.getAttribute('data-path'),t.getAttribute('data-label'));
    else if(a==='startask')startAsk();
    else if(/repos-toggle$/.test(a)) toggleReposPanel(a.replace('repos-toggle',''));
    else if(/repos-all$/.test(a)){ var nsAll=a.replace('repos-all',''); state[nsAll+'ReposAllOpen']=!state[nsAll+'ReposAllOpen']; renderRepos(nsAll); }
    else if(a==='askrepo'){ var nsR=a.replace(/repo$/,''); var rp=t.getAttribute('data-repo'); if(rp){ if(!state[nsR+'RepoSel'])state[nsR+'RepoSel']={}; state[nsR+'RepoSel'][rp]=!state[nsR+'RepoSel'][rp]; var inp=t.querySelector('input'); if(inp)inp.checked=state[nsR+'RepoSel'][rp]; var hn=document.getElementById(nsR+'RepoCount'); if(hn)hn.textContent=String(repoSelCount(nsR)); if(nsR==='ask')renderAskPlanes(); } }
    else if(/repos-(allsel|none)$/.test(a)){ var nsS=a.replace(/repos-(allsel|none)$/,''); var onS=/allsel$/.test(a); var bxS=document.getElementById(nsS+'RepoBody'); if(bxS){ if(!state[nsS+'RepoSel'])state[nsS+'RepoSel']={}; var rwS=bxS.querySelectorAll('[data-act="'+nsS+'repo"]'); for(var si=0;si<rwS.length;si++){ if(rwS[si].offsetParent===null)continue; /* genuinely visible only — skips search-filtered rows AND a collapsed all-repos section */ var sfn=rwS[si].getAttribute('data-repo'); state[nsS+'RepoSel'][sfn]=onS; var sip=rwS[si].querySelector('input'); if(sip)sip.checked=onS; } var scnt=document.getElementById(nsS+'RepoCount'); if(scnt)scnt.textContent=String(repoSelCount(nsS)); if(nsS==='ask')renderAskPlanes(); } }
    else if(a==='stop-run'){ var sid=t.getAttribute('data-id'); if(sid){ var _sr=runById(sid); var _q=!!(_sr&&_sr.status==='queued');
      var _msg=_q?'Cancel this queued run? It hasn’t started yet — it is removed.':'Stop this run? Work already done is kept; the run finalizes as “stopped”.';
      if(confirm(_msg)){ t.disabled=true; t.textContent=_q?'Canceling…':'Stopping…'; api('/api/runs/'+encodeURIComponent(sid)+'/stop',{method:'POST'}).then(function(){ loadState(); }); } } }
    else if(a==='rename-run'){ var rid=t.getAttribute('data-id'); if(!rid) return; var cur=''; (state.runs||[]).forEach(function(x){ if(x.id===rid) cur=x.alias||''; }); var na=prompt('Alias for this run (blank to clear). The rs_… id is preserved as the unique id.', cur); if(na===null) return; api('/api/runs/'+encodeURIComponent(rid)+'/alias',{method:'POST',body:{alias:na}}).then(function(){ loadState(); }); }
    else if(a==='title-edit'){ state.editingTitleRunId=t.getAttribute('data-id'); rerenderTitleEditContext(); }   // Edit the run/report TITLE inline (not the alias)
    else if(a==='title-cancel'){ state.editingTitleRunId=null; rerenderTitleEditContext(); }
    else if(a==='title-save'){ saveRunTitle(t.getAttribute('data-id')); }
    else if(a==='report-title-edit'){ if(!t.getAttribute('data-id')) return; state.editingTitleRunId=t.getAttribute('data-id'); rerenderTitleEditContext(); }   // Inline rename from the Report tab (card + header)
    else if(a==='report-trash-toggle'){ state.reportTrashView=!state.reportTrashView; state.reportFolderRun=null; renderReportList(); }
    else if(a==='mem-adds-toggle'){ var mtid=t.getAttribute('data-id'); if(!state.runMemAddsOpen)state.runMemAddsOpen={}; state.runMemAddsOpen[mtid]=!state.runMemAddsOpen[mtid]; renderRunDetail(); renderAskRunDetail(); }
    else if(a==='graph-lanes-toggle'){ state.graphLanesOpen=!state.graphLanesOpen; renderRunDetail(); }
    else if(a==='report-trash'){ var trid=t.getAttribute('data-id'); var _trr=runById(trid); if(!confirm(actionConfirmText('remove',{title:_trr?runTitle(_trr):''}))) return; api('/api/runs/'+encodeURIComponent(trid)+'/trash',{method:'POST'}).then(function(){ loadState(); }); }
    else if(a==='report-restore'){ var rrid=t.getAttribute('data-id'); api('/api/runs/'+encodeURIComponent(rrid)+'/restore',{method:'POST'}).then(function(){ loadState(); }); }
    else if(a==='report-empty'){ if(confirm('Permanently delete ALL trashed reports? This removes the cached report files and cannot be undone.')) api('/api/trash/empty',{method:'POST'}).then(function(){ loadState(); }); }
    // per-run report FOLDER: open a run's folder → its report list; back → all runs; open one artifact → the frame
    else if(a==='report-open-folder'){ var fid=t.getAttribute('data-id'); state.reportFolderRun=fid; state.activeRunId=fid; state.folderReportsOpen=false; state.folderBriefOpen=false; renderReportList(); }   // sync activeRunId so the report topbar targets THIS run, not a previously-viewed one
    else if(a==='report-folder-back'){ state.reportFolderRun=null; renderReportList(); }
    else if(a==='report-open-art'){ var aid=t.getAttribute('data-id'), ark=t.getAttribute('data-artkind');   // data-artkind, NOT data-rk: the global data-rk handler (line ~1513) runs first and would hijack it
      state.reportTabPush=!!(t.closest&&t.closest('#reportTabs')&&currentView()==='report'&&state.reportRunId);   // a reading-room tab switch → a history entry (syncReportUrl)
      if(ark==='bundle') openBundleReport(aid,t.getAttribute('data-bundle'));
      else if(ark==='combined') openCombined(aid);
      else if(ark==='provenance') openProvenance(aid);
      else if(ark==='leadership') openLeadership(aid);
      else if(ark==='workitems') openWorkItems(aid);
      else showReport(aid,'internal'); }   // the named Execution / Answer tab, not the Start-here pick
    else if(a==='lib-kind'){ state.libKind=t.getAttribute('data-kind')||'all'; renderReportList(); }
    else if(a==='skip-main'){ e.preventDefault(); var _mc=document.getElementById('mainContent'); if(_mc){ try{ _mc.focus(); }catch(_){} } }
    else if(a==='report-back'){ swapReportFrame('',false); state.reportTrashView=false; renderReportList(); }
  });
  // The key inputs sit in a <form> (browsers flag a password field outside one); Enter saves the keys instead of
  // submitting the page.
  document.addEventListener('submit',function(e){ var f=e.target; if(f&&(f.id==='setKeyForm'||f.id==='frKeyForm')){ e.preventDefault(); saveKeys(f.id==='frKeyForm'?'fr':'set'); } });
  document.addEventListener('keydown',function(e){ var t=e.target; if(e.key==='Enter'&&!e.isComposing&&t&&(t.id==='setAnthropic'||t.id==='setOpenAI'||t.id==='frAnthropic')){ e.preventDefault(); saveKeys(t.id==='frAnthropic'?'fr':'set'); } if(e.key==='Enter'&&t&&t.id==='setBudget'){ e.preventDefault(); saveBudget(); } });
  var _rs=document.getElementById('runHistorySearch'); if(_rs) _rs.addEventListener('input',function(e){state.runQuery=e.target.value||'';renderRunList();});
  var _as=document.getElementById('askHistorySearch'); if(_as) _as.addEventListener('input',function(e){state.askRunQuery=e.target.value||'';renderAskRunList();});
  document.addEventListener('input',function(e){ var t=e.target; if(t&&t.id==='libSearch'){ state.libQuery=t.value||''; state.libSearchFocus=true; renderReportList(); state.libSearchFocus=false; } });   // library search (the input is re-rendered, so delegate)
  // Esc closes the node detail pop-up (the reveal timer, if any, keeps running).
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ var _nc=document.getElementById('newChooser'); var _cp=document.getElementById('connPanel'); if(_nc&&!_nc.hidden){ closeChooser(); } else if(state.memDialog){ closeMemDialog(); } else if(state.modalOpen){ closeNodeModal(); } else if(_cp&&_cp.style.display==='flex'){ closeConnPanel(); } else if(state.cdShow){ cdClose(); } } });   // Esc also closes the Connect drawer
  // Inline title input: Enter saves, Escape cancels. Enter MUST NOT submit while an IME is composing
  // (a candidate confirm) — guard e.isComposing + keyCode 229.
  document.addEventListener('keydown',function(e){
    var t=e.target; if(!t||!t.getAttribute||t.getAttribute('data-act')!=='title-input') return;
    if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){ e.preventDefault(); saveRunTitle(t.getAttribute('data-id')); }
    else if(e.key==='Escape'){ e.preventDefault(); state.editingTitleRunId=null; rerenderTitleEditContext(); }
  });

  themeInit();
  selectSource('github');
  startApp();
})();

`;

export function renderApp(opts?: { version?: string; runMode?: 'agentic' | 'deterministic'; localAudit?: boolean; codeintelAvailable?: boolean; docRecoveryAvailable?: boolean; invariants?: { key: string; title: string; ranking?: boolean; floor?: boolean; owner?: string; mount?: string }[] }): string {
  const runmode = opts?.runMode === 'agentic' ? 'agentic' : 'deterministic';
  const localaudit = opts?.localAudit ? '1' : '0';
  const codeintelavail = opts?.codeintelAvailable ? '1' : '0';
  const docrecoveryavail = opts?.docRecoveryAvailable ? '1' : '0';
  const version = String(opts?.version ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 40);
  // Invariants (general + ranking-infra) for the run-config picker; ranking ones flagged.
  const invariantsJson = JSON.stringify(opts?.invariants ?? []).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>accel-scope</title>
<link rel="icon" type="image/png" href="${BEE_DATA_URI}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body data-runmode="${runmode}" data-localaudit="${localaudit}" data-codeintel="${codeintelavail}" data-docrecovery="${docrecoveryavail}" data-version="${version}" data-theme="dark">
<script>(function(){try{var v=localStorage.getItem('theme');var p=(v==='light'||v==='dark'||v==='auto')?v:'auto';document.body.setAttribute('data-theme',p==='auto'?((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'):p);}catch(_){}})();</script>

<a class="skip-link" href="#mainContent" data-act="skip-main">Skip to main content</a>
<aside class="sidebar">
  <div class="side-brand">
    <span class="bee"><img src="${BEE_DATA_URI}" alt="accel-scope" style="width:100%;height:100%;display:block;object-fit:cover;"></span>
    <div style="display:flex;flex-direction:column"><span class="nm">accel-scope</span><span class="eb">code &amp; data audit</span></div>
  </div>
  <button class="side-cta" data-act="newchoose" title="New" aria-label="New"><span style="font-size:17px;line-height:0;margin-top:-1px">+</span> New</button>
  <div class="side-eyebrow">Workspace</div>
  <nav class="nav">
    <button class="navitem" data-go="connect" title="Connect" aria-label="Connect"><span class="bar"></span><span class="glyph">◆</span><span class="lbl">Connect</span></button>
    <button class="navitem" data-go="ask" title="Quick Ask" aria-label="Quick Ask"><span class="bar"></span><span class="glyph">?</span><span class="lbl">Quick Ask</span></button>
    <button class="navitem" data-go="run" title="Full Scan" aria-label="Full Scan"><span class="bar"></span><span class="glyph">≡</span><span class="lbl">Full Scan</span></button>
    <button class="navitem" data-go="report" title="Report" aria-label="Report"><span class="bar"></span><span class="glyph">▤</span><span class="lbl">Report</span></button>
    <button class="navitem" data-go="memory" title="Memory" aria-label="Memory"><span class="bar"></span><span class="glyph">✦</span><span class="lbl">Memory</span></button>
    <button class="navitem" data-go="settings" title="Settings" aria-label="Settings"><span class="bar"></span><span class="glyph">⚙</span><span class="lbl">Settings</span></button>
  </nav>
  <div class="side-foot">
    <div class="side-status"><span class="d"></span>read-only · runs on this machine</div>
    <div class="side-ver" id="footVersion">${version ? 'v' + version : ''}</div>
  </div>
</aside>

<main class="main">
  <div class="boot-loading" id="bootLoading"><div class="boot-spin" role="status" aria-label="Loading"></div></div>
  <header class="ctx-topbar">
    <div class="ctx-lead" style="min-width:0">
      <div class="ctx-eyebrow" id="ctxEyebrow">STEP · SOURCES</div>
      <div class="ctx-title" id="ctxTitle">Connect read-only sources</div>
    </div>
    <div class="ctx-run" id="ctxRun" hidden></div>
    <div class="ctx-right">
      <span class="ctx-meta" id="ctxMeta"></span>
      <span class="ctx-runstats" id="ctxRunStats"></span>
      <button class="ctx-action honey" id="ctxAction" data-act="ctxaction" hidden></button>
      <div class="theme-seg" id="themeToggle"></div>
    </div>
  </header>

  <div class="stage" id="mainContent" tabindex="-1">

  <!-- Telemetry notice (shown once while telemetry is on) + FIRST-RUN key prompt (no Claude credential yet). -->
  <div class="tele-banner" id="teleBanner" role="status" hidden></div>
  <section class="firstrun" id="firstRun" role="region" aria-label="Add your Anthropic API key" hidden></section>

  <!-- CONNECT -->
  <section class="panel" data-panel="connect">
    <div class="doc">
      <div class="cx-wrap">
        <p class="cx-intro">Connect read-only sources: code (GitHub, public URLs, local folders) and data (BigQuery, data MCPs, key-value stores). Nothing here is ever modified.</p>
        <div id="connSummary" class="cx-summary"></div>
        <div id="connGrid" class="cx-grid"></div>
      </div>
      <div id="connBackdrop" class="cx-backdrop" style="display:none" data-act="close-conn"></div>
      <aside id="connPanel" class="cx-panel" style="display:none" role="dialog" aria-modal="false" aria-labelledby="connTitle">
        <div class="cx-panel-head"><div style="min-width:0"><div class="detail-kicker" id="connKicker">SOURCE · GITHUB</div><div class="detail-title" id="connTitle">Connect GitHub</div></div><button class="cx-panel-x" data-act="close-conn" aria-label="Close">✕</button></div>
        <div class="cx-panel-body scy">
          <div class="detail-body" id="connBody"></div>
          <div id="ghFields">
            <div id="ghTokenWrap">
              <div class="field"><label for="ghToken">GitHub token (read-only personal access token)</label><input id="ghToken" type="password" autocomplete="off" placeholder="ghp_… or github_pat_… (read-only · Contents + Metadata)"></div>
              <div class="hint">A fine-grained token with read-only <b>Contents</b> and <b>Metadata</b> is enough. Kept in memory unless Settings → Connections remembers credentials on this machine.</div>
            </div>
          </div>
          <div id="whFields" style="display:none">
            <div class="field"><label for="whSaJson">BigQuery service-account key JSON</label><textarea id="whSaJson" rows="6" spellcheck="false" placeholder='{ "type": "service_account", "project_id": "…", "client_email": "…", "private_key": "…" }'></textarea></div>
            <div class="hint">Give the service account read-only roles (BigQuery Data Viewer + Job User). The key is used only to query BigQuery, read-only.</div>
            <div class="hint" style="text-align:center;margin:12px 0 4px;opacity:.85">— or connect a warehouse MCP server —</div>
            <div class="field"><label for="whUrl">MCP URL</label><input id="whUrl" placeholder="https://warehouse-mcp.example/run"></div>
            <div class="field"><label for="whToken">MCP token</label><input id="whToken" type="password" autocomplete="off" placeholder="(optional)"></div>
          </div>
          <div id="kvFields" style="display:none">
            <div class="field"><label for="kvUrl">MCP URL</label><input id="kvUrl" placeholder="http://127.0.0.1:8772/mcp"></div>
            <div class="field"><label for="kvToken">MCP token</label><input id="kvToken" type="password" autocomplete="off" placeholder="(optional)"></div>
          </div>
          <div id="giturlFields" style="display:none">
            <div id="giturlConnected"></div>
            <div class="field"><label for="giturlUrls">Public GitHub repo URL(s) — one per line</label>
              <textarea id="giturlUrls" rows="4" spellcheck="false" style="font-family:var(--font-mono);font-size:13px"></textarea>
            </div>
            <div class="hint">Add more anytime — up to 20 repos.</div>
          </div>
          <div id="mcpFields" style="display:none">
            <div class="field">
              <label for="mcpList">Your read-only MCPs — all in one place</label>
              <textarea id="mcpList" rows="9" spellcheck="false" style="font-family:var(--font-mono);font-size:13px" placeholder='{
  "mcpServers": {
    "analytics": { "type": "http", "url": "https://analytics-mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } },
    "dashboard": { "type": "http", "url": "https://dashboard-mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}'></textarea>
            </div>
            <div class="hint" style="background:var(--honey-tint);border:1px solid var(--line);border-radius:9px;padding:9px 11px">
              Paste the standard <code class="mono">mcpServers</code> JSON (the block a <code class="mono">.mcp.json</code> holds), or one
              <code class="mono">name&nbsp;&nbsp;URL&nbsp;&nbsp;[token]</code> per line, then <b>Connect</b>.
              <div style="margin-top:6px">Each server mounts <b>read-only</b>. This is the single place for all your data MCPs — Connecting <b>replaces</b> the set. (A warehouse SQL plane has its own connector.)</div>
            </div>
          </div>
          <div id="localFields" style="display:none">
            ${localaudit === '1' ? `<div class="field"><label for="localPath">Folder path on this machine</label>
              <div style="display:flex;gap:8px">
                <input id="localPath" style="flex:1" placeholder="/path/to/your/repo  ·  or a parent folder">
                <button class="btn ghost" data-act="browse" style="white-space:nowrap">Browse…</button>
              </div>
            </div>
            <div id="localBrowser" style="display:none;border:1px solid var(--line);border-radius:11px;background:var(--cream);margin-bottom:12px;overflow:hidden">
              <div style="display:flex;align-items:center;gap:8px;padding:8px 11px;border-bottom:1px solid var(--line);background:var(--cream-card)">
                <span class="mono" id="browsePath" style="font-size:12px;color:var(--honey-link);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left"></span>
                <button class="btn honey" data-act="browse-use" style="font-size:12px;padding:5px 11px;white-space:nowrap">Use this folder</button>
              </div>
              <div id="browseList" class="scrolly" style="max-height:230px;overflow:auto;padding:5px"></div>
            </div>
            <div class="hint">Read-only. Browse to a folder, or type a path. Lists the git repos in it (or its immediate subfolders). Agents never write to your files.</div>
            <div class="hint" style="margin:14px 0 4px;text-align:center;opacity:.85">— or upload a copy of a folder —</div>` : ''}
            <div class="field"><label>Upload a folder from your computer</label>
              <input type="file" id="localUpload" webkitdirectory directory multiple style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">
              <button class="btn gh" data-act="pick-folder" style="width:100%;justify-content:center">Choose a code folder…</button>
            </div>
            <div id="localUploadInfo" class="hint" style="display:none"></div>
            <button class="btn honey" id="localUploadBtn" data-act="local-upload" style="width:100%;display:none;margin-bottom:8px">Upload &amp; connect</button>
            <div class="hint">Read-only. The upload is copied as a snapshot for the scan — <b>node_modules, .git, and build output are skipped</b>, and nothing is written back. Add more folders to scan several; pick which to scan in New Full Scan or Quick Ask.</div>
            <div id="localConnected"></div>
          </div>
          <div id="laterNote" style="display:none;color:var(--muted);font-size:14.5px;line-height:1.5">Coming later. Code and data sources are available now — pick one from the grid.</div>
          <div id="connectRow" style="display:flex;align-items:center;gap:12px"><button class="btn honey" data-act="addconn">Connect &amp; validate</button><span class="mono" id="connectMsg" style="font-size:13px;color:var(--honey-link)"></span></div>
          <div id="connDisconnect" style="display:none;margin-top:12px"></div>
        </div>
      </aside>
    </div>
  </section>

  <!-- ASK (scoped question → one answer report) -->
  <section class="panel" data-panel="ask">
    <div class="run-screen">
      <div class="run-strip-head">
        <div class="run-filters" role="tablist" aria-label="Ask status">
          <button class="run-filter active" data-ask-filter="all">All</button>
          <button class="run-filter" data-ask-filter="running">Running</button>
          <button class="run-filter" data-ask-filter="complete">Completed</button>
          <button class="run-filter" data-ask-filter="error">Failed</button>
        </div>
        <div class="run-search">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="askHistorySearch" placeholder="Search asks…">
        </div>
      </div>
      <div class="run-strip scrolly" id="askHistoryList"></div>
      <div class="run-detail-wrap">
      <div id="askRunDetail"></div>
      <!-- Compose entry (form + pipeline/log grid). Hidden while a past ask from the history strip is open —
           the detail there IS the full run-result view, so the compose entry would read as a second page. -->
      <div id="askComposeWrap" style="display:none">
      <div class="card" style="border-radius:16px">
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px"><div class="eyebrow" style="color:var(--num)">Compose a question</div><div class="mono" style="font-size:12.5px;color:var(--muted)">one investigate agent · read-only · grounded in refs</div></div>
        <div class="field" style="margin-bottom:12px">
          <textarea id="askQuestion" rows="4" maxlength="16000" placeholder="e.g. How is user cold-start defined? Quantify the candidate pools (sizes, freshness) from real data, not just code defaults."></textarea>
        </div>
        <div class="ask-compose-checks" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <input id="askScope" aria-label="Scope label (optional)" placeholder="Scope label (optional) — e.g. cold-start recall · ranking service" style="flex:1;min-width:180px;height:40px;border:1px solid var(--line);border-radius:9px;background:var(--card2);color:var(--espresso);padding:9px 11px;font-size:15px">
          <span data-act="askrepos-toggle" style="display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 13px;border:1px solid var(--line);border-radius:999px;background:var(--cream-card);cursor:pointer;font-size:13.5px;white-space:nowrap">Repos · <b id="askRepoCount">0</b> <span id="askRepoChev" style="color:var(--muted)">▸</span></span>
          <label style="display:inline-flex;align-items:center;gap:7px;font-size:14px;white-space:nowrap"><input type="checkbox" id="askFixes" checked> Work items</label>
          <label style="display:inline-flex;align-items:center;gap:7px;font-size:14px;white-space:nowrap"><input type="checkbox" id="askUseMemory" checked> Recall memory</label>
          <label style="display:inline-flex;align-items:center;gap:7px;font-size:14px;white-space:nowrap"><input type="checkbox" id="askWriteMemory"> Save learnings to memory</label>
          <button class="btn honey" id="askBtn" data-act="startask" style="height:40px">Ask →</button>
        </div>
        <div id="askRepoBody" style="display:none;margin-top:10px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;max-height:300px;overflow:auto"></div>
        <div id="askPlaneBox" style="margin-top:12px"></div>
        <div class="key-gate" id="askByoHint" style="display:none" role="alert">Add your Anthropic API key before asking — <a href="/settings" data-act="go-settings">open Settings</a>.</div>
        <p class="hint" id="askSaveHint" hidden>Save learnings to memory: after the run, durable facts it verified are added to your local memory — reviewable and revertable in Memory → History.</p>
        <p class="hint" id="askScopeLine">Reads only the repos and the read-only data sources you tick above. Read-only — nothing is written to your sources.</p>
        <p class="hint" id="askCapLine"></p>
      </div>
      <div class="grid2" style="grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card" style="border-radius:16px">
          <div class="eyebrow" style="margin-bottom:12px">Pipeline</div>
          <div id="askPipeline" style="display:flex;align-items:stretch;gap:10px">
            <div class="pstage" style="flex:1;text-align:center;border:1px solid var(--ok)">
              <span style="width:26px;height:26px;border-radius:50%;background:var(--ok-soft);color:var(--ok);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;font-weight:700">1</span>
              <h3>Investigate</h3><p style="margin-top:4px">grounded in refs</p>
            </div>
            <span class="mono" style="align-self:center;color:var(--muted);font-size:17px">→</span>
            <div class="pstage" style="flex:1;text-align:center">
              <span style="width:26px;height:26px;border-radius:50%;background:var(--track);color:var(--muted);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;font-weight:700">2</span>
              <h3>Report</h3><p style="margin-top:4px">self-contained HTML</p>
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
          <div class="log" id="askLog"><div style="color:#B9A38C">live ask log will stream here…</div></div>
          <div id="askMemoryCard"></div>
        </div>
      </div>
      </div><!-- /askComposeWrap -->
      </div>
    </div>
  </section>

  <!-- RUN -->
  <section class="panel" data-panel="run">
    <div class="run-screen">
      <div class="run-strip-head">
        <div class="run-filters" role="tablist" aria-label="Run status">
          <button class="run-filter active" data-run-filter="all">All</button>
          <button class="run-filter" data-run-filter="running">Running</button>
          <button class="run-filter" data-run-filter="complete">Completed</button>
          <button class="run-filter" data-run-filter="error">Failed</button>
        </div>
        <div class="run-search">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="runHistorySearch" placeholder="Search runs…">
        </div>
        <span id="runHistoryCount" hidden>0</span>
      </div>
      <div class="run-strip scrolly" id="runHistoryList"></div>
      <div class="run-detail-wrap"><section class="run-right" id="runDetail" aria-live="polite"></section></div>
    </div>
  </section>

  <!-- REPORT -->
  <section class="panel" data-panel="report">
    <div class="report-toggle" id="reportToggle" style="display:none"></div>
    <div class="report-list" id="reportList" style="display:none;padding:20px 30px 44px;max-width:var(--content-wide);margin:0 auto;width:100%"></div>
    <div class="reportwrap" id="reportWrap">
      <nav class="report-tabs" id="reportTabs" style="display:none"></nav>
      <div class="report-pane">
        <div class="report-empty" id="reportEmpty">
          <span class="bee" style="width:48px;height:48px"><img src="${BEE_DATA_URI}" alt="" style="width:100%;height:100%;display:block;object-fit:cover;"></span>
          <div>No report yet. Connect sources, then run a full scan.<br>The generated report appears here.</div>
          <button class="btn" data-go="run">Go to Full Scan</button>
        </div>
        <div class="report-loading" id="reportLoading" role="status" aria-live="polite" hidden><div class="rl-lab">Loading report…</div><div class="rl-sk h"></div><div class="rl-sk"></div><div class="rl-sk" style="width:82%"></div><div class="rl-sk b"></div><div class="rl-sk" style="width:64%"></div></div>
        <iframe id="reportFrame" title="diagnostic report" sandbox="allow-scripts allow-downloads" style="display:none"></iframe>
      </div>
    </div>
  </section>

  <!-- MEMORY (local knowledge store) -->
  <section class="panel" data-panel="memory">
    <div class="doc">
      <div id="memoryBody"></div>
    </div>
  </section>

  <!-- SETTINGS (API keys · per-run spending cap · connections · telemetry) -->
  <section class="panel" data-panel="settings">
    <div class="doc">
      <div id="settingsBody"></div>
    </div>
  </section>

  </div>
</main>

<!-- NEW chooser (Quick Ask vs Full Scan) -->
<div class="nc-overlay" id="newChooser" hidden data-act="choose-close">
  <div class="nc-card" role="dialog" aria-modal="true" aria-label="Start something new">
    <div class="nc-head">
      <div style="flex:1"><div class="nc-kicker">Start something new</div><h2 class="nc-title">What kind of run?</h2></div>
      <button class="nc-x" data-act="choose-close" aria-label="Close">✕</button>
    </div>
    <button class="nc-opt" data-act="choose-ask">
      <span class="nc-ico ask">?</span>
      <div style="flex:1;min-width:0"><div class="nc-opt-t">Quick Ask</div><div class="nc-opt-d">Ask one scoped question, grounded in your connected sources.</div><div class="nc-opt-m">read-only · minutes · nothing written<span id="ncCostAsk"></span></div></div>
      <span class="nc-arrow">&rarr;</span>
    </button>
    <button class="nc-opt scan" data-act="choose-scan">
      <span class="nc-ico scan">≡</span>
      <div style="flex:1;min-width:0"><div class="nc-opt-t">Full Scan</div><div class="nc-opt-d">${runmode === 'agentic' ? 'Audit the selected code end-to-end: an expert team per area poses and measures problems, then writes a Leadership brief + an Execution report.' : 'Scan the selected code for git, structure and committed-secret evidence and report it.'}</div><div class="nc-opt-m num">${runmode === 'agentic' ? 'agentic · 8-stage · resumable from checkpoints · read-only' : 'deterministic · evidence only · no agents'}<span id="ncCostScan"></span></div></div>
      <span class="nc-arrow">&rarr;</span>
    </button>
    <div class="nc-foot">every run bills your own API keys · per-run cap in <a href="/settings" data-act="go-settings">Settings</a></div>
  </div>
</div>

<div class="nodemodal" id="nodeModal" hidden></div>
<div class="nodemodal" id="memDialog" hidden></div>

<script>window.__INV__=${invariantsJson};</script>
<script>window.__BEE__=${JSON.stringify(BEE_DATA_URI)};</script>
<script>${CLIENT}</script>
</body>
</html>`;
}

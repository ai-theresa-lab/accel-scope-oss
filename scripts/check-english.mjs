#!/usr/bin/env node
// Fails when any tracked text file contains CJK characters. The project is English-only: UI, reports, prompts, tests
// and docs. Code that has to recognise CJK input writes the ranges as \u escapes, which this check does not flag.
//
//   npm run check:english
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// CJK Unified Ideographs (+ Extension A), CJK symbols & punctuation, Hiragana, Katakana, Hangul, full-width forms.
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz)$/i;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];
for (const file of files) {
  if (BINARY.test(file)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (CJK.test(lines[i])) hits.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
  }
}
if (hits.length) {
  console.error(`check-english: ${hits.length} line(s) contain CJK characters (the project is English-only):`);
  for (const h of hits.slice(0, 200)) console.error('  ' + h);
  if (hits.length > 200) console.error(`  ... and ${hits.length - 200} more`);
  process.exit(1);
}
console.log(`check-english: ${files.length} tracked file(s), no CJK characters.`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitleReply } from './runTitle.ts';
import { orgRunTitleSource } from '../run/execute-org-run.ts';

// with no brief the org run titled its bare targetName ("1 folder"); Haiku's refusal or an
// invented title ("Make repository public") then replaced the run's name.
test('cleanTitleReply: a real title is normalized and kept', () => {
  assert.equal(cleanTitleReply('Title: "Checkout funnel metric drift."'), 'Checkout funnel metric drift');
});

test('cleanTitleReply: a refusal / clarification / question is not a title', () => {
  for (const r of [
    'I need clarification — "1 folder" doesn\'t contain an engineering question. Could you provide the full question or task y',
    'Could you share more context?',
    'What should this be called?',
    'Please provide the question you want titled',
  ]) assert.equal(cleanTitleReply(r), undefined, r);
});

test('orgRunTitleSource: only an agentic run with a brief gets a title call', () => {
  assert.equal(orgRunTitleSource({ mode: 'agentic', brief: '  Why did retention drop?  ' }), 'Why did retention drop?');
  assert.equal(orgRunTitleSource({ mode: 'agentic', brief: '' }), undefined, 'no brief → keep the targetName');
  assert.equal(orgRunTitleSource({ mode: 'agentic', brief: undefined }), undefined);
  assert.equal(orgRunTitleSource({ mode: 'deterministic', brief: 'Why did retention drop?' }), undefined, 'deterministic makes no LLM call');
});

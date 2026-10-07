// Claude Haiku title distiller — turns a long question/brief into a short, clean scope label. SHARED by
// the server (run titles) and the CLI / scoped report (the report h1). FAIL-OPEN by contract: any error, empty
// output, or missing credential returns undefined so the caller keeps its fallback (a run/report must never fail
// to get a title).
//
// Runs through the shared `runAgent` wrapper (tool-free, 1 turn, Haiku) — NOT a direct SDK `query` — so the title
// LLM call counts against the ambient budget ledger and passes through the global concurrency semaphore like every
// other run step (a no-op ledger when none is set, e.g. the CLI). runAgent also owns the BYO-credential path
// (authToken) + the settings/tool hardening, so no key or systemPrompt handling is needed here.
import { runAgent } from './agent.ts';

// Normalize the model's reply to a title, or undefined when the reply is NOT a title (fail-open → the caller keeps its
// fallback). Given too little to title, Haiku answers with a refusal / clarification request ("I need clarification —
// \"1 folder\" doesn't contain an engineering question. Could you…"), which then REPLACED the run's name.
// A title is short, is not a question, and does not talk to the user.
const NOT_A_TITLE = /\b(i need|i can(?:'|no)t|i'm (?:not|unable|sorry)|i am (?:not|unable|sorry)|could you|can you|please (?:provide|share|clarify)|clarif\w*|doesn't contain|does not contain|no (?:engineering )?question|not enough (?:context|information))\b/i;
export function cleanTitleReply(raw: string): string | undefined {
  // Normalize: single line, strip wrapping quotes / a leading "Title:" label / trailing punctuation, bound length.
  let title = String(raw || '').replace(/\s+/g, ' ').trim();
  title = title.replace(/^title\s*[:\-]\s*/i, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/[.\s]+$/, '').trim();
  if (!title) return undefined;
  if (NOT_A_TITLE.test(title) || /\?$/.test(title) || title.split(' ').length > 14) return undefined;
  return title.slice(0, 120);
}

export async function generateRunTitle(question: string, authToken: string | undefined): Promise<string | undefined> {
  const q = String(question || '').trim();
  if (!q) return undefined;
  try {
    // runAgent has no separate systemPrompt slot → fold the "output only the title" instruction into the prompt.
    const prompt = 'You turn a question into a short, human-readable title. Output ONLY the title — no quotes, no preamble, no explanation.\n\n'
      + 'Write a concise, clean title (a short scope label) for this engineering question. '
      + 'Rules: 3-8 words, no surrounding quotes, no trailing punctuation, no preamble like "Title:". '
      + `Reply with ONLY the title text.\n\nQuestion:\n${q.slice(0, 2000)}`;
    const r = await runAgent({ cwd: process.cwd(), prompt, model: 'claude-haiku-4-5', maxTurns: 1, toolFree: true, authToken, label: 'run-title' });
    return cleanTitleReply(String(r.text || r.allText || ''));
  } catch {
    return undefined;   // fail-open — caller keeps its fallback
  }
}

// Robustly pull a JSON object out of an agent's free-text reply. Agents are
// instructed to end with a single fenced ```json block; this tolerates stray
// prose before/after and a missing fence.

export function extractJson<T = any>(text: string): T | null {
  if (!text) return null;
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(text);
  for (const c of candidates) {
    const t = c.trim();
    try {
      return JSON.parse(t) as T;
    } catch {
      /* try slicing to the outermost braces */
    }
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1)) as T;
      } catch {
        /* give up on this candidate */
      }
    }
  }
  return null;
}

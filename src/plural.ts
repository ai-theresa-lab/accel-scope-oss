// "1 repo" / "2 repos" — the report renderers' one count-noun helper (the deterministic report
// once printed "1 repos · 2 people", "across 1 repos", "1 commits across 1 repos" while the UI had correct plurals).
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

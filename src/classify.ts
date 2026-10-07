// Shared path classification helpers (noise filtering, test detection, language,
// committed-secret detection).
// NOTE: gitHistory.ts keeps its own inline copy for now; TODO consolidate there.

export const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'rb',
  'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'scala', 'sql', 'sqlx', 'sh',
]);

const NOISE_DIR = /(^|\/)(node_modules|dist|build|\.next|out|vendor|coverage|\.turbo|\.git|__pycache__|\.venv|venv)\//;
const NOISE_FILE = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.(js|css)|\.map|\.snap|\.lock)$/;
const BINARY_EXT = /\.(png|jpe?g|gif|svg|ico|pdf|woff2?|ttf|eot|mp4|mov|zip|gz|tgz|wasm|webp|icns|joblib|pkl|bin|pt|pth|onnx|parquet|csv|tsv)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)|\.(test|spec|e2e)\.[tj]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go|ts)$|(^|\/)conftest\.py$/i;

export function isNoise(p: string): boolean {
  return NOISE_DIR.test('/' + p) || NOISE_FILE.test(p) || BINARY_EXT.test(p);
}
export function isTest(p: string): boolean {
  return TEST_RE.test(p);
}
export function ext(p: string): string {
  const m = p.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '(none)';
}
export function moduleOf(p: string): string {
  const s = p.split('/');
  return s.length <= 1 ? s[0] : s.slice(0, Math.min(2, s.length - 1)).join('/');
}

// Filename-pattern secret detection (cheap, content-free). A committed file
// matching these is a finding regardless of contents.
export function isSecretFile(p: string): boolean {
  if (/\.env\.(example|sample|template|dist)$/i.test(p)) return false;
  return (
    /(^|\/)\.env($|\.)/.test(p) ||
    /\.pem$/i.test(p) ||
    /\.p12$/i.test(p) ||
    /(^|\/)id_rsa$/i.test(p) ||
    /(^|\/)config\.(prod|production|stage|staging)\.(ya?ml|json|toml)$/i.test(p) ||
    /service[-_]?account.*\.json$/i.test(p) ||
    /(^|\/)[a-z0-9-]+-[0-9a-f]{12}\.json$/i.test(p) ||
    /(^|\/)(credentials?|secrets?)\.(json|ya?ml)$/i.test(p)
  );
}

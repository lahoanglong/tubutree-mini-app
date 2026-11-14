export interface ChainStep {
  status: number;
  path: string;
  search: string;
  next: { origin: string; path: string; search: string } | null;
}
export type ExpectedOutcome = { kind: 'redirect'; location: string } | { kind: 'gone' } | { kind: 'none' };
export interface ChainFlags {
  loop?: boolean;
  tooMany?: boolean;
  external?: boolean;
}
export interface ChainVerdict {
  verdict: 'PASS' | 'WARN' | 'FAIL';
  reason: string;
  notes: string[];
}
export interface CliOptions {
  base: string;
  resolveIp: string;
  hostHeader: string;
  sitemaps: string[];
  urls: string;
  blog: 'proxy' | 'skip';
  method: 'HEAD' | 'GET';
  concurrency: number;
  timeout: number;
  limit: number;
  strict: boolean;
  json: boolean;
  offline: boolean;
  help: boolean;
}
export function isRedirectStatus(status: number): boolean;
export function parseSitemapLocs(xml: string): string[];
export function toPathAndSearch(input: string): { path: string; search: string } | null;
export function sameTarget(a: { path: string; search: string }, b: { path: string; search: string }): boolean;
export function isSlashHop(step: ChainStep): boolean;
export function classifyChain(input: { expected: ExpectedOutcome; steps: ChainStep[]; flags?: ChainFlags }): ChainVerdict;
export function walk(input: { base: string; resolveIp?: string; hostHeader?: string; path: string; search?: string; method?: string; timeout?: number }): Promise<{ steps: ChainStep[]; flags: ChainFlags }>;
export function expectedFor(resolution: { kind: 'redirect'; location: string } | { kind: 'gone' } | null): ExpectedOutcome;
export function parseArgs(argv: string[]): CliOptions;
export interface OfflineTable {
  resolveLegacyWpPath(pathname: string): { kind: 'redirect'; status: 301; location: string } | { kind: 'gone'; status: 410 } | null;
  isWpBlogPath(pathname: string): boolean;
}
export interface OfflineRow {
  path: string;
  search: string;
  expected: ExpectedOutcome | { kind: 'blog' };
  steps: ChainStep[];
  notes: string[];
  verdict: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  reason: string;
}
export function defaultInventory(table: { LEGACY_PAGE_REDIRECTS: Record<string, string>; LEGACY_FILE_REDIRECTS: Record<string, string>; LEGACY_PRODUCT_REDIRECTS: Record<string, string>; LEGACY_GONE_EXACT: readonly string[] }): { path: string; search: string }[];
export function checkRuleTableOffline(table: OfflineTable, inputs: { path: string; search: string }[], options?: { requireRule?: boolean }): OfflineRow[];

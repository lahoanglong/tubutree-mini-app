import type { ChainFlags, ChainStep, OfflineTable } from '../ops/check-cutover-redirects.mjs';

export type Level = 'PASS' | 'WARN' | 'FAIL';
export interface Finding {
  check: string;
  level: Level;
  message: string;
}
export interface CliOptions {
  base: string;
  canonical: string;
  resolveIp: string;
  dryRun: boolean;
  build: boolean;
  buildDir: string;
  vhost: string;
  urls: string;
  sample: number;
  pages: number;
  skip: string[];
  concurrency: number;
  timeout: number;
  strict: boolean;
  allowNoCampaigns: boolean;
  json: boolean;
  help: boolean;
}
export type RuleResolution = { kind: 'redirect'; status: 301; location: string } | { kind: 'gone'; status: 410 } | null;
export interface RedirectTable extends OfflineTable {
  LEGACY_PAGE_REDIRECTS: Record<string, string>;
  LEGACY_FILE_REDIRECTS: Record<string, string>;
  LEGACY_PRODUCT_REDIRECTS: Record<string, string>;
  LEGACY_GONE_EXACT: readonly string[];
}
export interface Report {
  mode: 'dry-run' | 'live';
  canonical: string;
  base?: string;
  resolveIp?: string | null;
  findings: Finding[];
}
export type Requester = (url: URL, init?: { method?: string; headers?: Record<string, string>; maxBody?: number }) => Promise<{
  status: number;
  location: string | null;
  headers?: Record<string, string | string[] | undefined>;
  body?: Buffer;
  error?: string;
}>;

export function isLocalOrStagingHost(host: string): boolean;
export function hostProblem(url: string, canonicalOrigin: string): string | null;
export function findBadHosts(urls: string[], canonicalOrigin: string): { url: string; reason: string }[];
export function checkSitemapXml(xml: string): { errors: string[]; warnings: string[]; locs: string[]; root: string | null };
export function analyzeSitemap(locs: string[], canonicalOrigin: string, opts?: { allowNoCampaigns?: boolean }): { counts: { total: number; products: number; categories: number; campaigns: number }; findings: Finding[] };
export function checkRobots(text: string, canonicalOrigin: string): Finding[];
export function checkSecurityHeaders(headers: Record<string, string | string[] | undefined>, options?: { https?: boolean; where?: string; check?: string }): Finding[];
export function extractCanonical(html: string): string | null;
export function extractMeta(html: string, key: string): string | null;
export function extractJsonLd(html: string): Record<string, unknown>[];
export function extractImgUrls(html: string, pageUrl?: string): string[];
export function imgFindings(request: Requester, html: string, pageUrl: string, base: string): Promise<Finding[]>;
export function followRedirects(input: {
  base: string;
  path: string;
  search?: string;
  request: (url: URL) => Promise<{ status: number; location: string | null }>;
  maxHops?: number;
}): Promise<{ steps: ChainStep[]; flags: ChainFlags }>;
export function findRuleCycles(resolve: (pathname: string) => RuleResolution, sources: string[], maxDepth?: number): string[][];
export function evenSample<T>(list: T[], n: number): T[];
export function checkApexVhost(text: string): Finding[];
export function parseArgs(argv: string[]): CliOptions;
export function runDryRun(opts: Partial<CliOptions> & { table?: RedirectTable; root?: string; nextConfig?: unknown }): Promise<Report>;
export function runLive(opts: Partial<CliOptions> & { base: string; table?: RedirectTable; root?: string; request?: Requester }): Promise<Report>;

import type { Finding } from '../../cutover/verify-apex-cutover.mjs';

export type { Finding };
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}
export interface GuardResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  location: string | null;
  body: string;
  error?: string;
}
export type UrlKind = 'home' | 'legal' | 'product' | 'category' | 'brand' | 'storefront' | 'campaign' | 'static';
export interface GuardOptions {
  base: string;
  canonical?: string;
  maxPerKind?: number;
  concurrency?: number;
  timeout?: number;
  legalSlugs?: readonly string[];
  request?: (url: string) => Promise<GuardResponse>;
}
export interface CliOptions extends GuardOptions {
  json: boolean;
  strict: boolean;
  help: boolean;
  maxPerKind: number;
  concurrency: number;
  timeout: number;
}
export interface GuardReport {
  base: string;
  canonical: string;
  counts: Partial<Record<UrlKind, number>>;
  checked: number;
  findings: Finding[];
}

export const LEGAL_SLUGS: readonly string[];
export const SAMPLED_KINDS: readonly UrlKind[];
export function parseRobots(text: string | null | undefined): RobotsRules;
export function robotsVerdict(path: string, rules: RobotsRules): { allowed: boolean; rule: string | null };
export function sameUrl(a: string, b: string): boolean;
export function isNoindex(value: string | null | undefined): boolean;
export function kindOf(loc: string): UrlKind;
export function analyzeLocs(
  locs: readonly string[],
  canonicalOrigin: string,
  opts?: { legalSlugs?: readonly string[] },
): { counts: Partial<Record<UrlKind, number>>; findings: Finding[] };
export function pageProblems(loc: string, res: GuardResponse, robots: RobotsRules): string[];
export function pickLocs(locs: readonly string[], maxPerKind?: number): string[];
export function runGuard(opts: GuardOptions): Promise<GuardReport>;
export function parseArgs(argv: readonly string[]): CliOptions;
export function summarize(findings: readonly Finding[]): { pass: number; warn: number; fail: number };

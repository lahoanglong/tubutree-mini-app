export interface Tree {
  read(repoRelativePath: string): string | null;
  list(repoRelativeDir: string): string[];
  readMany?(repoRelativePaths: string[]): Map<string, string | null>;
}
export interface PreflightContext {
  root: string;
  head: Tree;
  base: Tree | null;
  baseRef?: string | null;
  changed: string[] | null;
}
export interface RuleResult {
  errors: string[];
  warnings: string[];
  notes: string[];
}
export interface Rule {
  id: string;
  title: string;
  check(ctx: PreflightContext): RuleResult | Promise<RuleResult>;
}
export const RULES: readonly Rule[];
export function buildContext(input?: { root?: string; base?: string }): PreflightContext;
export function runPreflight(ctx: PreflightContext, opts?: { only?: string[] }): Promise<(RuleResult & { id: string; title: string; ms: number })[]>;
export function main(argv?: string[], io?: { log: (s: string) => void; error: (s: string) => void }): Promise<number>;

export function fsTree(root: string): Tree;
export function memTree(files: Record<string, string>): Tree;
export function gitTree(root: string, ref: string): Tree & { readMany(repoRelativePaths: string[]): Map<string, string | null> };
export function resolveBase(root: string, explicit?: string): string | null;
export function changedFiles(root: string, base: string): string[];

export function normalizePath(raw: string): string;
export function extractGetCalls(ts: unknown, text: string, file: string): { path: string; line: number; ignored: boolean }[];
export function mockedGetPaths(mockApiSource: string): Set<string>;
export function mockCovers(mockPattern: string, path: string): boolean;
export function stripSqlComments(sql: string): string;

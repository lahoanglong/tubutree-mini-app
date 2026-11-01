export interface Counts {
  px: number;
  maxMd: number;
}
export type RatchetKind = 'px' | 'maxMd';
export interface Baseline {
  px: Record<string, number>;
  maxMd: Record<string, number>;
  guards: Record<string, Record<string, Record<string, number>>>;
}
export function inScope(repoRelativePath: string): boolean;
export function countPx(source: string, fileName: string): number;
export function countMaxMd(source: string, fileName: string): number;
export function scanTree(input?: { root?: string; list?: () => string[]; readFile?: (repoRelativePath: string) => string }): Record<string, Counts>;
export function compareCounts(input: { kind: RatchetKind; baseline: Record<string, number>; current: Record<string, number> }): { errors: string[]; notices: string[] };
export function readBaseline(file: string): Baseline;
export function writeBaseline(file: string, baseline: Baseline): void;
export function main(argv?: string[]): number;

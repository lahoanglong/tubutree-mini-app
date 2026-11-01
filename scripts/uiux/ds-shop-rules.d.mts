export type Platform = 'miniapp' | 'web';
export interface GuardRule {
  id: string;
  platform: Platform;
  scope: (relativeToSrc: string) => boolean;
  pattern: RegExp;
  why: string;
}
export const GUARD_RULES: readonly GuardRule[];
export function ruleCounts(input: { platform: Platform; files: { rel: string; text: string }[] }): Record<string, Record<string, number>>;
export function guardViolations(input: {
  platform: Platform;
  files: { rel: string; text: string }[];
  baseline: Record<string, Record<string, number>>;
}): { errors: string[]; notices: string[] };
export function loadPlatformFiles(root: string, platform: Platform): { rel: string; text: string }[];

export interface ParityInput {
  miniappRoutes: string[];
  miniappRedirects?: { from: string; to: string }[];
  map: { routes: { lane: string; items: Record<string, unknown>[] }[]; features: unknown[] };
  webFileExists: (repoRelativePath: string) => boolean;
  fileHasSymbol: (repoRelativePath: string, symbol: string) => boolean;
  strict?: boolean;
}
export function parseMiniAppRoutes(source: string): string[];
export function parseMiniAppRedirects(source: string): { from: string; to: string }[];
export function webPathToFileCandidates(webPath: string): string[];
export function checkParity(input: ParityInput): { errors: string[]; warnings: string[] };

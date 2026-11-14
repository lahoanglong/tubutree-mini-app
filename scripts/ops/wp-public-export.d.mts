export interface ExportOptions {
  out: string;
  uploadsDir: string;
  origin: string;
  resolveIp: string;
  concurrency: number;
  delayMs: number;
  limit: number;
  dryRun: boolean;
  help: boolean;
}
export function parseArgs(argv: string[]): ExportOptions;
export function safeUploadPath(pathname: string): string | null;
export function collectUploadPaths(value: unknown, into?: Set<string>): Set<string>;

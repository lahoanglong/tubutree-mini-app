export function isDroppable404(data: unknown): boolean;
export const notFoundStore: {
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
  now: () => number;
  entries: Map<string, { value: unknown; at: number; size: number }>;
  bytes: number;
  get(key: string): { value: unknown; at: number; size: number } | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
};
export default class IsrCacheHandler {
  constructor(ctx: { fs: unknown; flushToDisk?: boolean; serverDistDir: string; revalidatedTags: string[]; maxMemoryCacheSize?: number });
  get(key: string, ctx: Record<string, unknown>): Promise<unknown>;
  set(key: string, data: unknown, ctx: Record<string, unknown>): Promise<void>;
}

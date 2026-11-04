export function isDroppable404(data: unknown): boolean;
export default class IsrCacheHandler {
  constructor(ctx: { fs: unknown; flushToDisk?: boolean; serverDistDir: string; revalidatedTags: string[]; maxMemoryCacheSize?: number });
  get(key: string, ctx: Record<string, unknown>): Promise<unknown>;
  set(key: string, data: unknown, ctx: Record<string, unknown>): Promise<void>;
}

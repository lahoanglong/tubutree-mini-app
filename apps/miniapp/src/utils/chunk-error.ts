const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|Unable to preload CSS|error loading dynamically/i;

/** Lỗi tải mã (chunk) từ mạng/CDN: dựng lại không cứu được, chỉ tải lại app mới lấy lại mã. */
export function isChunkError(error: unknown): boolean {
  return CHUNK_ERROR.test(error instanceof Error ? `${error.name} ${error.message}` : String(error));
}

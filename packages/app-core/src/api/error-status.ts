/**
 * Mã HTTP của một lỗi gọi API, không phụ thuộc client: ApiError của web có `status`, AxiosError của Mini App có `response.status`.
 */
export function errorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status;
  return typeof e.response?.status === 'number' ? e.response.status : undefined;
}

/** Mã lỗi nghiệp vụ ổn định của API (vd CHAT_DAILY_LIMIT): ApiError của web mang ở `code`, HttpError của Mini App ở `response.data.code`. */
export function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; response?: { data?: { code?: unknown } } };
  if (typeof e.response?.data?.code === 'string') return e.response.data.code;
  return typeof e.code === 'string' ? e.code : null;
}

/**
 * Mã HTTP của một lỗi gọi API, không phụ thuộc client: ApiError của web có `status`, AxiosError của Mini App có `response.status`.
 */
export function errorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status;
  return typeof e.response?.status === 'number' ? e.response.status : undefined;
}

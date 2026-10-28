export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  headers?: Record<string, string>;
  /** Endpoint công khai chạy ở trình duyệt: không gửi Authorization (khỏi preflight CORS và khỏi luồng refresh khi 401) và không cache. */
  anonymous?: boolean;
}

export interface HttpClient {
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T>(path: string, opts?: RequestOptions): Promise<T>;
}

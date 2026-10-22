import { vi } from 'vitest';

export type Reply = { status: number; headers?: Record<string, string>; body?: unknown };
export type FetchCall = { url: string; init: RequestInit; headers: Headers; at: number };

const toResponse = (r: Reply): Response => {
  const body = r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  // Response không cho body với 204/205/304.
  const empty = r.status === 204 || r.status === 205 || r.status === 304;
  return new Response(empty ? null : body, { status: r.status, headers: r.headers });
};

/** fetch giả: ghi lại từng lần gọi; `respond` quyết định trả gì (hoặc ném lỗi) cho lần gọi thứ n. */
export function stubFetch(respond: (call: FetchCall, n: number) => Reply | Error | Promise<Reply | Error>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: FetchCall = { url: String(input), init, headers: new Headers(init.headers), at: Date.now() };
    calls.push(call);
    const out = await respond(call, calls.length);
    if (out instanceof Error) throw out;
    return toResponse(out);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

/** fetch không bao giờ trả lời, chỉ kết thúc khi signal bị abort (như trình duyệt: ném AbortError). */
export function stubHangingFetch() {
  const calls: FetchCall[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, headers: new Headers(init.headers), at: Date.now() });
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

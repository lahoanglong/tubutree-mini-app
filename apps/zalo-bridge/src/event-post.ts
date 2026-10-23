import type { PostResult } from './outbox';
import type { ZaloBridgeEvent } from './types';

export interface EventPosterDeps {
  url: string;
  secret: string;
  fetchFn?: typeof fetch;
  notify: (m: { idempotencyKey: string; text: string }) => Promise<unknown>;
}

const TIMEOUT_MS = 10_000;

export function createEventPoster(deps: EventPosterDeps): (e: ZaloBridgeEvent) => Promise<PostResult> {
  const doFetch = deps.fetchFn ?? fetch;
  return async (event) => {
    let res: Response;
    try {
      res = await doFetch(deps.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${deps.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return 'retry';
    }
    // 503 là API cố ý bảo gửi lại sau (vd chat đang tắt); 5xx khác là lỗi tạm. 4xx còn lại gửi lại cũng vô ích.
    if (res.status >= 500) return 'retry';
    if (res.status < 200 || res.status >= 300) return 'drop';
    const body = (await res.json().catch(() => null)) as { unknownCode?: unknown } | null;
    if (event.type === 'message' && typeof body?.unknownCode === 'string') {
      // Báo lỗi lên nhóm cho nhân viên biết tin chưa tới khách; lỗi ở đây không được làm sự kiện gốc bị gửi lại.
      await deps
        .notify({
          idempotencyKey: `unknown-${event.msgId}`,
          text: `Không tìm thấy mã #${body.unknownCode}, tin chưa tới khách.`,
        })
        .catch(() => console.error('[bridge] không báo được mã lạ lên nhóm'));
    }
    return 'ok';
  };
}

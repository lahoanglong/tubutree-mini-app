import type { PostResult } from './outbox';
import type { ZaloBridgeEvent } from './types';

export interface EventPosterDeps {
  url: string;
  secret: string;
  fetchFn?: typeof fetch;
  notify: (m: { idempotencyKey: string; text: string }) => Promise<unknown>;
}

const TIMEOUT_MS = 10_000;

// Không mở đầu bằng # để chính thông báo không bị đọc lại như một lệnh trả lời.
const NOT_STORED_NOTICE: Record<string, string> = {
  unsupported: 'Tin trả lời này không phải chữ hay ảnh (sticker, tệp, thoại...) nên chưa tới khách. Gõ lại bằng chữ.',
  gone: 'Khách của tin được trích đã xoá tài khoản, tin chưa tới khách.',
  empty: 'Tin trả lời chỉ có mã, chưa có nội dung nên chưa tới khách. Gõ thêm nội dung rồi gửi lại.',
};

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
    if (res.status < 200 || res.status >= 300) {
      try {
        await res.body?.cancel();
      } catch {
        // thân đã đóng
      }
    }
    // Chỉ 400 và 413 là yêu cầu hỏng mà gửi lại không bao giờ sửa được. Mọi mã khác (401 lệch khoá khi đang xoay khoá,
    // 404 sai địa chỉ, 503 chat đang tắt, 5xx) đều có thể hết sau khi vận hành sửa, và outbox tự bỏ sau 24 giờ.
    if (res.status === 400 || res.status === 413) return 'drop';
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 401) console.error('[bridge] API từ chối khoá (401) — kiểm tra ZALO_BRIDGE_SECRET');
      return 'retry';
    }
    const body = (await res.json().catch(() => null)) as {
      unknownCode?: unknown;
      notStored?: unknown;
      conflict?: { routed?: unknown; typed?: unknown };
    } | null;
    if (event.type === 'message' && typeof body?.conflict?.routed === 'string' && typeof body.conflict.typed === 'string') {
      void deps
        .notify({
          idempotencyKey: `conflict-${event.msgId}`,
          text: `Tin trả lời trích tin của #${body.conflict.routed} nhưng ghi mã #${body.conflict.typed}, chưa gửi cho khách nào. Trích đúng tin hoặc chỉ ghi một mã rồi gửi lại.`,
        })
        .catch(() => console.error('[bridge] không báo được mã xung đột lên nhóm'));
    }
    const notStoredText = typeof body?.notStored === 'string' ? NOT_STORED_NOTICE[body.notStored] : undefined;
    if (event.type === 'message' && notStoredText) {
      void deps
        .notify({ idempotencyKey: `unsent-${event.msgId}`, text: notStoredText })
        .catch(() => console.error('[bridge] không báo được tin chưa tới khách lên nhóm'));
    }
    if (event.type === 'message' && typeof body?.unknownCode === 'string') {
      // Báo lên nhóm không được await: nó đi qua hàng đợi gửi giãn cách (có thể chờ hàng giờ) và sẽ chặn cả hộp thư đi; lỗi cũng không được làm sự kiện gốc bị gửi lại.
      void deps
        .notify({
          idempotencyKey: `unknown-${event.msgId}`,
          text: `Không tìm thấy mã #${body.unknownCode}, tin chưa tới khách.`,
        })
        .catch(() => console.error('[bridge] không báo được mã lạ lên nhóm'));
    }
    return 'ok';
  };
}

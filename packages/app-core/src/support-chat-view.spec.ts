import { describe, expect, it } from 'vitest';
import type { SupportChatMessageDTO } from '@tubutree/shared-types';
import { byTime, mergeWindow, sendFailureKind } from './support-chat-view';

const m = (n: number, over: Partial<SupportChatMessageDTO> = {}): SupportChatMessageDTO => ({
  id: `m${n}`, sender: 'STAFF', body: `tin ${n}`, imageUrl: null, context: null, clientMsgId: null, createdAt: `2026-10-23T03:0${n}:00.000Z`, ...over,
});
const store = (...msgs: SupportChatMessageDTO[]) => new Map(msgs.map((x) => [x.id, x]));
const ids = (s: Map<string, SupportChatMessageDTO>) => [...s.values()].sort(byTime).map((x) => x.id);

describe('byTime', () => {
  it('xếp theo createdAt rồi id', () => {
    const a = m(1, { createdAt: '2026-10-23T03:00:00.000Z', id: 'b' });
    const b = m(2, { createdAt: '2026-10-23T03:00:00.000Z', id: 'a' });
    expect([a, b].sort(byTime).map((x) => x.id)).toEqual(['a', 'b']);
    expect([m(3), m(1), m(2)].sort(byTime).map((x) => x.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('mergeWindow', () => {
  it('ghi đè theo id và thêm tin mới', () => {
    const next = mergeWindow(store(m(3), m(4)), [m(3, { body: 'sửa' }), m(4), m(5)], true);
    expect(ids(next)).toEqual(['m3', 'm4', 'm5']);
    expect(next.get('m3')!.body).toBe('sửa');
  });

  it('tin từ đầu cửa sổ trở đi mà không còn trong cửa sổ là đã thu hồi; tin chỉ ở trang cũ thì giữ', () => {
    const next = mergeWindow(store(m(1), m(2), m(3), m(4), m(5)), [m(3), m(5)], true);
    expect(ids(next)).toEqual(['m1', 'm2', 'm3', 'm5']);
  });

  it('hết tin (hasMore=false): chỉ giữ tin của cửa sổ, kể cả tin cũ đã tải trước đó', () => {
    expect(ids(mergeWindow(store(m(1), m(2), m(3)), [m(3)], false))).toEqual(['m3']);
    expect(ids(mergeWindow(store(m(1)), [], false))).toEqual([]);
  });

  it('cửa sổ rỗng nhưng còn tin cũ (hasMore=true): giữ nguyên', () => {
    expect(ids(mergeWindow(store(m(1)), [], true))).toEqual(['m1']);
  });

  it('không sửa kho gốc', () => {
    const prev = store(m(1), m(2));
    mergeWindow(prev, [m(2)], false);
    expect(ids(prev)).toEqual(['m1', 'm2']);
  });
});

describe('sendFailureKind', () => {
  it('429 → rate-limited (vẫn gửi lại được); 4xx khác → rejected; mạng/5xx → failed', () => {
    expect(sendFailureKind(429)).toBe('rate-limited');
    expect(sendFailureKind(400)).toBe('rejected');
    expect(sendFailureKind(403)).toBe('rejected');
    expect(sendFailureKind(409)).toBe('rejected');
    expect(sendFailureKind(500)).toBe('failed');
    expect(sendFailureKind(503)).toBe('failed');
    expect(sendFailureKind(undefined)).toBe('failed');
  });
});

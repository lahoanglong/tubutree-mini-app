// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { RefillTab } from './refill-tab';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const PENDING = [
  { id: 'rf1', quantity: 3, seedsAwarded: 30, status: 'PENDING', createdAt: '2026-10-14T03:00:00.000Z', user: { id: 'u1', fullName: 'An', phone: '0912345678' } },
];

describe('RefillTab — từ chối đổi vỏ', () => {
  it('ô lý do giới hạn 200 ký tự (đúng trần của API) và gửi lý do đã nhập', async () => {
    const api = mockFetch({
      '/refill/admin/pending': { body: PENDING },
      '/refill/admin/rf1/reject': { body: { ok: true } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<RefillTab />);
    mounted.push(r);
    await flush();

    click(byText(r.container, 'button', 'Từ chối'));
    await flush();
    const reason = confirmDialog()!.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input')!;
    expect(reason.maxLength).toBe(200);

    typeInto(reason, 'vỏ không đúng loại');
    answerConfirm(true);
    await flush();
    const post = api.calls.find((c) => c.url.includes('/refill/admin/rf1/reject'))!;
    expect(JSON.parse(String(post.init?.body))).toEqual({ reason: 'vỏ không đúng loại' });
  });
});

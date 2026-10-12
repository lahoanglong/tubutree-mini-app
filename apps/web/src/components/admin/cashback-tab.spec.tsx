// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CashbackTab } from './cashback-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TXN = {
  id: 't1',
  userId: 'u1',
  provider: 'accesstrade',
  merchantOrderId: 'SP-9001',
  orderAmount: 500_000,
  commission: 25_000,
  userReward: 12_000,
  status: 'PENDING',
  confirmedAt: null,
  paidAt: null,
  user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
  merchant: { name: 'Shopee', slug: 'shopee' },
};

function stub() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url.includes('/review') ? { ...TXN, status: 'CONFIRMED' } : [TXN];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return { calls, reviews: () => calls.filter((c) => c.url.includes('/review')) };
}

// C-122 (review): "Duyệt hoàn tiền" chi tiền thật nhưng không hỏi lại; "Từ chối" dùng window.prompt gốc của trình duyệt.
describe('CashbackTab (Hoàn tiền sàn ngoài)', () => {
  it('liệt kê giao dịch chờ duyệt: sàn, đơn, khách, số tiền khách nhận', async () => {
    stub();
    const { container } = mount(<CashbackTab />);
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('Shopee · SP-9001');
    expect(t).toContain('Nguyễn An · 0900000001');
    expect(t).toContain('Duyệt hoàn tiền');
  });

  it('Duyệt hoàn tiền: hỏi xác nhận nêu số tiền — huỷ thì KHÔNG gọi API; đồng ý thì POST CONFIRMED', async () => {
    const api = stub();
    const { container } = mount(<CashbackTab />);
    await flush();

    click(byText(container, 'button', 'Duyệt hoàn tiền'));
    await flush(1);
    expect(confirmDialog()?.textContent).toContain('SP-9001');
    expect(confirmDialog()?.textContent).toContain('12.000');
    answerConfirm(false);
    await flush();
    expect(api.reviews()).toHaveLength(0);

    click(byText(container, 'button', 'Duyệt hoàn tiền'));
    await flush(1);
    answerConfirm(true);
    await flush();
    expect(api.reviews()).toHaveLength(1);
    expect(api.reviews()[0]!.url).toContain('/admin/cashback/transactions/t1/review');
    expect(JSON.parse(String(api.reviews()[0]!.init?.body))).toMatchObject({ status: 'CONFIRMED' });
  });

  it('Từ chối: ô nhập lý do trong hộp thoại DS (không window.prompt); Huỷ thì không gọi API; xác nhận gửi lý do đã trim', async () => {
    const api = stub();
    const nativePrompt = vi.spyOn(window, 'prompt');
    const { container } = mount(<CashbackTab />);
    await flush();

    click(byText(container, 'button', 'Từ chối'));
    await flush(1);
    expect(confirmDialog()?.querySelector('textarea')).not.toBeNull();
    typeInto(confirmDialog()!.querySelector('textarea'), 'gõ rồi thôi');
    answerConfirm(false);
    await flush();
    expect(api.reviews()).toHaveLength(0);

    click(byText(container, 'button', 'Từ chối'));
    await flush(1);
    typeInto(confirmDialog()!.querySelector('textarea'), '  Sàn báo huỷ đơn  ');
    answerConfirm(true);
    await flush();
    expect(nativePrompt).not.toHaveBeenCalled();
    expect(api.reviews()).toHaveLength(1);
    expect(JSON.parse(String(api.reviews()[0]!.init?.body))).toEqual({ status: 'REJECTED', note: 'Sàn báo huỷ đơn' });
  });

  it('Từ chối không ghi lý do: vẫn từ chối được, không gửi note rỗng', async () => {
    const api = stub();
    const { container } = mount(<CashbackTab />);
    await flush();
    click(byText(container, 'button', 'Từ chối'));
    await flush(1);
    answerConfirm(true);
    await flush();
    const body = JSON.parse(String(api.reviews()[0]!.init?.body)) as Record<string, unknown>;
    expect(body.status).toBe('REJECTED');
    expect(body.note).toBeUndefined();
  });
});

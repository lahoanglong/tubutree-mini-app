// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GoodwillCreditList, GoodwillCreditResult } from '@tubutree/shared-types';
import { GoodwillCreditSection, goodwillDraftError } from './goodwill-credit-section';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

const LIST: GoodwillCreditList = {
  perGrantMax: 200_000,
  dailyCap: 1_000_000,
  dailyUsed: 150_000,
  items: [
    { id: 'l1', kind: 'WALLET', amount: 30_000, reason: 'Giao trễ ba ngày', orderCode: 'TB9', actorId: 'a2', actorName: 'Hà Admin', createdAt: '2026-11-28T03:00:00.000Z' },
  ],
};
const RESULT: GoodwillCreditResult = {
  id: 'log1',
  kind: 'POINTS',
  amount: 50_000,
  orderCode: 'TB1',
  entryId: 'p1',
  replayed: false,
  dailyUsed: 200_000,
  dailyCap: 1_000_000,
  createdAt: '2026-11-28T04:00:00.000Z',
};

interface Call {
  method: string;
  url: string;
  key: string | null;
  body: unknown;
}
let calls: Call[] = [];
let mounted: Rendered | null = null;

function stub(opts: { list?: GoodwillCreditList; post?: () => { status: number; body: unknown } } = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      calls.push({ method, url, key: headers.get('Idempotency-Key'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const res = method === 'POST' ? (opts.post?.() ?? { status: 200, body: RESULT }) : { status: 200, body: opts.list ?? LIST };
      return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const posts = () => calls.filter((c) => c.method === 'POST');

async function mountSection() {
  mounted = render(<GoodwillCreditSection userId="u1" customerName="Lan" orderCodes={['TB1', 'TB2']} />);
  await flush();
  return mounted.container;
}

function fill(root: HTMLElement, v: { kind?: 'POINTS' | 'WALLET'; amount?: string; reason?: string; order?: string }) {
  if (v.kind) click(root.querySelector(`input[name="goodwill-kind"][value="${v.kind}"]`));
  if (v.amount !== undefined) typeInto(root.querySelector('input[name="goodwill-amount"]'), v.amount);
  if (v.reason !== undefined) typeInto(root.querySelector('textarea[name="goodwill-reason"]'), v.reason);
  if (v.order !== undefined) selectValue(root.querySelector('select[name="goodwill-order"]'), v.order);
}

const submit = (root: HTMLElement) => click(byText(root, 'button[type=submit]', 'Tặng'));

describe('goodwillDraftError — chặn lỗi nhập trước khi hỏi xác nhận', () => {
  const ok = { kind: 'POINTS' as const, amount: '50000', reason: 'Giao trễ ba ngày', orderCode: '' };
  it.each([
    [{ ...ok, amount: '' }, 'Nhập số tặng là số nguyên lớn hơn 0.'],
    [{ ...ok, amount: '0' }, 'Nhập số tặng là số nguyên lớn hơn 0.'],
    [{ ...ok, amount: '1.5' }, 'Nhập số tặng là số nguyên lớn hơn 0.'],
    [{ ...ok, amount: '200001' }, 'Mỗi lần tặng tối đa 200.000.'],
    [{ ...ok, reason: '  ngắn  ' }, 'Lý do cần ít nhất 10 ký tự.'],
  ])('%j → %s', (d, msg) => {
    expect(goodwillDraftError(d, 1_000_000)).toBe(msg);
  });
  it('vượt phần còn lại của hạn mức hôm nay', () => {
    expect(goodwillDraftError(ok, 40_000)).toBe('Hôm nay bạn chỉ còn tặng được 40.000.');
    expect(goodwillDraftError(ok, 50_000)).toBeNull();
  });
});

describe('GoodwillCreditSection (w51-01)', () => {
  it('hiện hạn mức hôm nay và lần tặng gần nhất kèm người tặng, đơn, lý do nội bộ', async () => {
    stub();
    const root = await mountSection();
    expect(root.querySelector('[data-goodwill-quota]')!.textContent).toContain('150.000/1.000.000');
    const recent = root.querySelector('[data-goodwill-recent]')!.textContent!;
    expect(recent).toContain('+30.000');
    expect(recent).toContain('Hà Admin');
    expect(recent).toContain('đơn TB9');
    expect(recent).toContain('Giao trễ ba ngày');
  });

  it('lý do quá ngắn: báo lỗi tại chỗ, không mở hộp xác nhận, không gửi', async () => {
    stub();
    const root = await mountSection();
    click(byText(root, 'button', 'Tặng thiện chí'));
    fill(root, { amount: '50000', reason: 'ngắn' });
    submit(root);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(root.querySelector('[role=alert]')!.textContent).toContain('Lý do cần ít nhất 10 ký tự.');
  });

  it('xác nhận rồi gửi đúng thân + Idempotency-Key; xong thì tải lại hạn mức và báo nhãn khách thấy', async () => {
    stub();
    const root = await mountSection();
    click(byText(root, 'button', 'Tặng thiện chí'));
    fill(root, { kind: 'POINTS', amount: '50000', reason: '  Giao trễ ba ngày  ', order: 'TB1' });
    submit(root);
    await flush();
    expect(confirmDialog()!.textContent).toContain('Tặng 50.000 Điểm Xanh?');
    expect(confirmDialog()!.textContent).toContain('gắn đơn TB1');
    const listLoads = calls.filter((c) => c.method === 'GET').length;
    answerConfirm(true);
    await flush();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.url).toContain('/admin/users/u1/goodwill-credits');
    expect(posts()[0]!.body).toEqual({ kind: 'POINTS', amount: 50000, reason: 'Giao trễ ba ngày', orderCode: 'TB1' });
    expect(posts()[0]!.key).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(listLoads);
    expect(root.querySelector('[role=status]')!.textContent).toContain('Khách thấy dòng "Quà tặng từ Tubu Tree"');
    expect(root.querySelector('form')).toBeNull();
  });

  it('huỷ ở hộp xác nhận: không gửi', async () => {
    stub();
    const root = await mountSection();
    click(byText(root, 'button', 'Tặng thiện chí'));
    fill(root, { amount: '10000', reason: 'Khách chờ hàng lâu' });
    submit(root);
    await flush();
    answerConfirm(false);
    await flush();
    expect(posts()).toHaveLength(0);
  });

  it('5xx (chưa rõ đã ghi chưa): tải lại danh sách và ghim khoá, sửa nội dung rồi gửi vẫn cùng khoá; 4xx hay thành công mới đổi khoá', async () => {
    let next: { status: number; body: unknown } = { status: 503, body: { message: 'Máy chủ bận' } };
    stub({ post: () => next });
    const root = await mountSection();
    click(byText(root, 'button', 'Tặng thiện chí'));
    fill(root, { kind: 'WALLET', amount: '20000', reason: 'Giao nhầm màu nắp' });
    const send = async () => {
      submit(root);
      await flush();
      answerConfirm(true);
      await flush();
    };
    const gets = () => calls.filter((c) => c.method === 'GET').length;
    const before = gets();
    await send();
    expect(gets()).toBeGreaterThan(before);
    expect(root.querySelector('[role=alert]')!.textContent).toContain('Chưa rõ lần tặng đã ghi hay chưa');
    fill(root, { reason: 'Giao nhầm màu nắp.' });
    await send();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.key).toBe(posts()[0]!.key);
    expect(posts()[1]!.body).toMatchObject({ reason: 'Giao nhầm màu nắp.' });
    next = { status: 409, body: { statusCode: 409, message: 'Mã chống trùng này đã dùng cho một lần tặng khác.' } };
    await send();
    expect(posts()[2]!.key).toBe(posts()[0]!.key);
    next = { status: 200, body: RESULT };
    await send();
    expect(posts()).toHaveLength(4);
    expect(posts()[3]!.key).not.toBe(posts()[0]!.key);
  });

  it('cùng nội dung bấm lại sau 4xx: khoá mới (lần trước không ghi gì); cùng nội dung chưa gửi lỗi thì giữ khoá', async () => {
    let next: { status: number; body: unknown } = { status: 400, body: { statusCode: 400, message: 'Vượt trần tặng trong ngày của bạn.' } };
    stub({ post: () => next });
    const root = await mountSection();
    click(byText(root, 'button', 'Tặng thiện chí'));
    fill(root, { amount: '20000', reason: 'Giao nhầm màu nắp' });
    submit(root);
    await flush();
    answerConfirm(true);
    await flush();
    next = { status: 200, body: RESULT };
    submit(root);
    await flush();
    answerConfirm(true);
    await flush();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.key).not.toBe(posts()[0]!.key);
  });

  it('máy chủ trả replayed: báo đã ghi trước đó, không nói đã tặng thêm', async () => {
    stub({ post: () => ({ status: 200, body: { ...RESULT, replayed: true } }) });
    const root = await mountSection();
    click(byText(root, 'button', 'Tặng thiện chí'));
    fill(root, { amount: '50000', reason: 'Giao trễ ba ngày' });
    submit(root);
    await flush();
    answerConfirm(true);
    await flush();
    expect(root.querySelector('[role=status]')!.textContent).toContain('đã ghi trước đó, không cộng thêm');
  });

  it('hết hạn mức hôm nay: nút khoá, chữ nói rõ', async () => {
    stub({ list: { ...LIST, dailyUsed: 1_000_000 } });
    const root = await mountSection();
    const btn = byText(root, 'button', 'Hết hạn mức hôm nay') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Khoá chạm đúp của kênh đại lý (Mini ↔ web, Wave 76): gửi hồ sơ, đặt đơn (Trả trước + Ghi công nợ chung một khoá), báo đã chuyển khoản,
// lưu/xoá mẫu đơn, nhận thưởng. Mọi ca "cùng tick" gọi click hai lần trong MỘT act: state chưa kịp vẽ lại giữa hai cú bấm.

type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };
type Deferred = { promise: Promise<unknown>; resolve: (v?: unknown) => void; reject: (e: unknown) => void };

const m = vi.hoisted(() => ({
  search: new URLSearchParams(),
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  /** Mỗi lần GET path này sẽ đợi hàm trả lời hứa (nếu có): giữ lần tải lại để thấy khoá còn giữ khi dữ liệu mới chưa về. */
  getGate: {} as Record<string, () => Promise<unknown> | undefined>,
  post: {} as Record<string, () => unknown>,
  del: {} as Record<string, () => unknown>,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'DEALER' } }) }));
vi.mock('@/components/brand-owner/brand-image-field', () => ({
  BrandImageField: ({ label, onChange }: { label: string; onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('data:image/jpeg;base64,AAAA')}>{`Chọn ${label}`}</button>
  ),
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dai-ly',
  useSearchParams: () => m.search,
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      m.calls.push({ method: 'get', path });
      await m.getGate[path]?.();
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      m.calls.push({ method: 'post', path, body, headers: opts?.headers });
      const h = m.post[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
    delete: async (path: string) => {
      m.calls.push({ method: 'delete', path });
      const h = m.del[path];
      return h ? h() : { ok: true };
    },
  },
}));

import DealerPage from './page';

const APPROVED = { isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 1_000_000 };
const NOT_DEALER = { isDealer: false, status: 'NONE', tier: null, currentDebt: 0 };
const row = { variationId: 'v1', sku: 'POLANG-500', product: 'Nước rửa chén', brand: 'Pơ Lang', variation: '500ml', retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 9 };
const REPORT = {
  quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 1, orderCount: 1, pendingRevenue: 0, pendingOrderCount: 0,
  bonusPct: 0, bonusAmount: 0, nextTier: null, tiers: [],
};
const reward = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'TOUR', title: `Thưởng ${id}`, description: null, threshold: 1, period: 'QUARTER', periodKey: 'Q3/2026',
  periodLabel: 'Quý 3/2026', isCurrentPeriod: true, volume: 2, pendingVolume: 0, achieved: true, toGo: 0, claimStatus: null, claimId: null,
  rejectionReason: null, claimDeadline: '2026-10-30T17:00:00.000Z', canClaim: true, ...over,
});
const claimOk = { success: true, alreadyClaimed: false, claimStatus: 'PENDING', message: 'Đã ghi nhận yêu cầu nhận thưởng.', claim: { id: 'c1', status: 'PENDING', periodKey: 'Q3/2026', volumeAtClaim: 1, createdAt: '' } };

const defer = (): Deferred => {
  let resolve!: (v?: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
/** Mọi lần GET `path` kể từ lúc gọi hàm này bị giữ tới khi gọi `release()`. */
const holdGet = (path: string) => {
  const gate = defer();
  m.getGate[path] = () => gate.promise;
  return {
    release: () => {
      delete m.getGate[path];
      gate.resolve();
    },
  };
};

let mounted: Rendered[] = [];
const mount = async (search = '') => {
  m.search = new URLSearchParams(search);
  const r = render(<DealerPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const posts = (path: string) => m.calls.filter((c) => c.method === 'post' && c.path === path);
const gets = (path: string) => m.calls.filter((c) => c.method === 'get' && c.path === path);
const dels = (path: string) => m.calls.filter((c) => c.method === 'delete' && c.path === path);
const buttons = (name: string | RegExp) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((b) => (typeof name === 'string' ? (b.getAttribute('aria-label') ?? b.textContent) === name : name.test(b.getAttribute('aria-label') ?? b.textContent ?? '')));
const button = (name: string | RegExp) => buttons(name)[0]!;
const sameTick = (...els: (HTMLElement | undefined)[]) =>
  act(() => {
    for (const el of els) el!.click();
  });
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const field = (c: HTMLElement, label: string) => {
  const l = Array.from(c.querySelectorAll('label')).find((x) => x.textContent === label)!;
  return document.getElementById(l.getAttribute('for')!) as HTMLInputElement;
};
const amountInput = () => {
  const label = byText(document.body, 'label', 'Số tiền đã chuyển');
  return document.getElementById((label as HTMLLabelElement).htmlFor) as HTMLInputElement;
};
const setup = (over: Record<string, unknown> = {}) => {
  m.data = {
    '/dealer/me': APPROVED,
    '/dealer/pricelist': [row],
    '/dealer/templates': [],
    '/dealer/orders': [],
    '/dealer/credit-ledger': { balance: 3_000_000, entries: [] },
    '/dealer/quarterly-report': REPORT,
    '/dealer/rewards': { claimGraceDays: 30, rewards: [] },
    ...over,
  };
};

beforeEach(() => {
  m.calls = [];
  m.getGate = {};
  m.post = {};
  m.del = {};
  setup();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/dai-ly — gửi hồ sơ đăng ký đại lý', () => {
  const fill = (c: HTMLElement) => {
    typeInto(field(c, 'Tên doanh nghiệp / cửa hàng *'), 'Cửa hàng An');
    typeInto(field(c, 'Người đại diện *'), 'Nguyễn An');
    typeInto(field(c, 'Số điện thoại *'), '0901234567');
    typeInto(field(c, 'Địa chỉ kinh doanh *'), '1 Lê Lợi');
    click(button('Chọn Ảnh CCCD mặt trước *'));
    click(button('Chọn Ảnh CCCD mặt sau *'));
  };
  beforeEach(() => setup({ '/dealer/me': NOT_DEALER }));
  const sendBtn = () => buttons(/^(Gửi hồ sơ đăng ký|Đang gửi…)$/)[0]!;

  it('hai cú bấm cùng tick chỉ gửi một hồ sơ; nút báo aria-busy + aria-disabled, KHÔNG disabled thật', async () => {
    const post = defer();
    m.post['/dealer/apply'] = () => post.promise;
    const c = await mount();
    fill(c);
    const submit = sendBtn();
    sameTick(submit, submit);
    await flush();
    expect(posts('/dealer/apply')).toHaveLength(1);
    expect(busy(submit)).toBe(true);
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe('Đang gửi…');
    post.resolve({ ok: true });
    await flush();
  });

  it('gửi form (Enter) rồi bấm nút cùng tick vẫn chỉ một hồ sơ', async () => {
    m.post['/dealer/apply'] = () => new Promise(() => undefined);
    const c = await mount();
    fill(c);
    const form = c.querySelector('form')!;
    act(() => {
      form.requestSubmit();
      sendBtn().click();
    });
    await flush();
    expect(posts('/dealer/apply')).toHaveLength(1);
  });

  it('khoá giữ tới khi hồ sơ mới về: POST xong mà tải lại hồ sơ còn treo thì bấm lần hai vẫn bị chặn', async () => {
    m.post['/dealer/apply'] = () => ({ ok: true });
    const c = await mount();
    fill(c);
    const gate = holdGet('/dealer/me');
    click(sendBtn());
    await flush();
    expect(posts('/dealer/apply')).toHaveLength(1);
    const submit = sendBtn();
    expect(busy(submit)).toBe(true);
    click(submit);
    await flush();
    expect(posts('/dealer/apply')).toHaveLength(1);
    m.data['/dealer/me'] = { ...NOT_DEALER, status: 'PENDING' };
    gate.release();
    await flush(8);
    expect(document.body.textContent).toContain('Hồ sơ đang được duyệt');
  });

  it('lỗi: hiện role=alert, nhả khoá để gửi lại; ô nhập giữ nguyên chữ', async () => {
    let n = 0;
    m.post['/dealer/apply'] = () => {
      n += 1;
      if (n === 1) throw new Error('Số điện thoại đã đăng ký');
      return { ok: true };
    };
    const c = await mount();
    fill(c);
    click(sendBtn());
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Số điện thoại đã đăng ký');
    expect(busy(sendBtn())).toBe(false);
    expect(field(c, 'Số điện thoại *').value).toBe('0901234567');
    click(sendBtn());
    await flush();
    expect(posts('/dealer/apply')).toHaveLength(2);
  });

  it('gửi đúng bản hồ sơ lúc bấm, kể cả khi khách sửa ô trong lúc đang gửi; không xoá chữ khi thành công', async () => {
    const post = defer();
    m.post['/dealer/apply'] = () => post.promise;
    const c = await mount();
    fill(c);
    click(sendBtn());
    typeInto(field(c, 'Địa chỉ kinh doanh *'), '99 Nguyễn Huệ');
    post.resolve({ ok: true });
    await flush();
    expect((posts('/dealer/apply')[0]!.body as { address: string }).address).toBe('1 Lê Lợi');
    expect(field(c, 'Địa chỉ kinh doanh *').value).toBe('99 Nguyễn Huệ');
  });
});

describe('/dai-ly — lỗi tải hồ sơ: Thử lại không gọi chồng', () => {
  it('hai cú bấm Thử lại cùng tick chỉ tải lại một lần; nhả khi xong', async () => {
    m.getGate['/dealer/me'] = () => Promise.reject(new Error('Máy chủ bận'));
    await mount();
    const before = gets('/dealer/me').length;
    const gate = defer();
    m.getGate['/dealer/me'] = () => gate.promise;
    await captureUnhandledRejections(async () => {
      sameTick(button('Thử lại'), button('Thử lại'));
      await flush();
    });
    expect(gets('/dealer/me').length - before).toBe(1);
    gate.resolve();
    await flush();
  });
});

describe('/dai-ly — đặt đơn (Trả trước và Ghi công nợ chung một khoá)', () => {
  const addOne = () => click(document.querySelector<HTMLButtonElement>('button[aria-label^="Tăng số lượng"]'));
  // Thanh đặt hàng dựng hai bản (khung máy tính và thanh dính đáy): bản nào cũng phải chặn như nhau.
  const ghi = () => buttons(/^(Ghi công nợ|Đang đặt…)$/);
  const tra = () => buttons('Trả trước');

  it('Ghi công nợ hai lần cùng tick và Ghi công nợ + Trả trước cùng tick: đều chỉ một đơn', async () => {
    const post = defer();
    m.post['/dealer/orders'] = () => post.promise;
    await mount();
    addOne();
    sameTick(ghi()[0], ghi()[0]);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    sameTick(tra()[0], ghi()[1], tra()[1]);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    post.resolve({ code: 'TUBU1', items: [] });
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
  });

  it('Trả trước rồi Ghi công nợ trong cùng tick: chỉ lệnh đầu đi, đúng phương thức PREPAID', async () => {
    m.post['/dealer/orders'] = () => new Promise(() => undefined);
    await mount();
    addOne();
    sameTick(tra()[0], ghi()[0]);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    expect((posts('/dealer/orders')[0]!.body as { paymentMethod: string }).paymentMethod).toBe('PREPAID');
  });

  it('đang đặt: cả hai nút ở cả hai thanh báo aria-busy + aria-disabled, KHÔNG disabled thật', async () => {
    m.post['/dealer/orders'] = () => new Promise(() => undefined);
    await mount();
    addOne();
    click(ghi()[0]!);
    await flush();
    for (const b of [...tra(), ...buttons('Đang đặt…')]) {
      expect(busy(b)).toBe(true);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
    }
  });

  it('lỗi: role=alert, nhả khoá, bấm lại gửi lại với CÙNG Idempotency-Key', async () => {
    let n = 0;
    m.post['/dealer/orders'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return { code: 'TUBU2', items: [] };
    };
    const c = await mount();
    addOne();
    click(ghi()[0]!);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
    expect(busy(ghi()[0]!)).toBe(false);
    click(ghi()[0]!);
    await flush();
    const keys = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('giỏ gửi đi là giỏ lúc bấm: đổi số lượng trong lúc bay thì đơn trả về vẫn so với giỏ đã gửi', async () => {
    const post = defer();
    m.post['/dealer/orders'] = () => post.promise;
    const c = await mount();
    addOne();
    click(ghi()[0]!);
    addOne();
    post.resolve({ code: 'TUBU3', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] });
    await flush();
    expect(posts('/dealer/orders')[0]!.body).toMatchObject({ items: [{ variationId: 'v1', quantity: 1 }] });
    expect(c.textContent).toContain('Đã tạo đơn đại lý!');
  });

  it('khoá giữ tới khi công nợ mới về: giỏ còn nguyên (đơn cũ khác giỏ) mà tải lại treo thì bấm tiếp vẫn bị chặn', async () => {
    m.post['/dealer/orders'] = () => ({ code: 'TUBU4', items: [{ variationId: 'v-khac', quantity: 9, backorderedQty: 0 }] });
    await mount();
    addOne();
    const gate = holdGet('/dealer/me');
    click(ghi()[0]!);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    expect(busy(ghi()[0]!)).toBe(true);
    click(ghi()[0]!);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    gate.release();
    await flush();
    expect(busy(ghi()[0]!)).toBe(false);
    click(ghi()[0]!);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(2);
  });
});

describe('/dai-ly — đặt đơn: khoá giữ tới khi công nợ mới về (đơn đúng giỏ)', () => {
  it('đặt xong giỏ được dọn; công nợ mới còn treo thì thêm hàng và bấm đặt lần nữa vẫn bị chặn, về rồi mới đặt được', async () => {
    m.post['/dealer/orders'] = () => ({ code: 'TUBU5', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] });
    await mount();
    const add = () => click(document.querySelector<HTMLButtonElement>('button[aria-label^="Tăng số lượng"]'));
    const order = () => buttons(/^(Ghi công nợ|Đang đặt…)$/)[0]!;
    add();
    const gate = holdGet('/dealer/me');
    click(order());
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    add();
    expect(busy(order())).toBe(true);
    click(order());
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    gate.release();
    await flush();
    expect(busy(order())).toBe(false);
    click(order());
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(2);
  });
});

describe('/dai-ly — báo đã chuyển khoản (tiền)', () => {
  const open = () => mount('tab=credit');
  const pay = () => buttons(/^(Báo đã chuyển khoản|Đang gửi…)$/)[0]!;

  it('hai cú bấm cùng tick chỉ gọi API một lần, đúng số tiền; nút aria-busy, KHÔNG disabled', async () => {
    const post = defer();
    m.post['/dealer/credit-payment'] = () => post.promise;
    await open();
    typeInto(amountInput(), '1000000');
    sameTick(pay(), pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(1);
    expect(posts('/dealer/credit-payment')[0]!.body).toEqual({ amount: 1_000_000, note: 'Báo đã chuyển khoản' });
    expect(busy(pay())).toBe(true);
    expect(pay().getAttribute('aria-disabled')).toBe('true');
    expect(pay().disabled).toBe(false);
    post.resolve({ ok: true });
    await flush();
  });

  it('số tiền gửi là số lúc bấm lần đầu dù ô bị đổi trong lúc bay; số gõ thêm không bị xoá khi thành công', async () => {
    const post = defer();
    m.post['/dealer/credit-payment'] = () => post.promise;
    await open();
    typeInto(amountInput(), '1000000');
    click(pay());
    typeInto(amountInput(), '2000000');
    click(pay());
    post.resolve({ ok: true });
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(1);
    expect((posts('/dealer/credit-payment')[0]!.body as { amount: number }).amount).toBe(1_000_000);
    expect(amountInput().value).toBe('2000000');
  });

  it('thành công với ô vẫn là số vừa gửi thì ô được xoá và key đổi cho lần báo sau', async () => {
    m.post['/dealer/credit-payment'] = () => ({ ok: true });
    await open();
    typeInto(amountInput(), '1000000');
    click(pay());
    await flush();
    expect(amountInput().value).toBe('');
    typeInto(amountInput(), '500000');
    click(pay());
    await flush();
    const keys = posts('/dealer/credit-payment').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('khoá giữ tới khi dư nợ mới về: POST xong mà sổ công nợ tải lại còn treo thì bấm lần hai vẫn bị chặn', async () => {
    m.post['/dealer/credit-payment'] = () => ({ ok: true });
    await open();
    typeInto(amountInput(), '1000000');
    const gate = holdGet('/dealer/credit-ledger');
    click(pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(1);
    expect(busy(pay())).toBe(true);
    // Ô đã xoá sau khi gửi; gõ số mới trong lúc dư nợ cũ còn hiện thì cú bấm vẫn không được gửi.
    typeInto(amountInput(), '1000000');
    click(pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(1);
    gate.release();
    await flush();
    expect(busy(pay())).toBe(false);
    click(pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(2);
  });

  it('lỗi: role=alert, nhả khoá; bấm lại giữ nguyên Idempotency-Key', async () => {
    let n = 0;
    m.post['/dealer/credit-payment'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return { ok: true };
    };
    await open();
    typeInto(amountInput(), '1000000');
    click(pay());
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Mất kết nối');
    expect(busy(pay())).toBe(false);
    expect(amountInput().value).toBe('1000000');
    click(pay());
    await flush();
    const keys = posts('/dealer/credit-payment').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('lý do cứng vẫn là disabled thật: ô trống hoặc vượt dư nợ', async () => {
    await open();
    expect(pay().disabled).toBe(true);
    typeInto(amountInput(), '9000000');
    expect(pay().disabled).toBe(true);
  });
});

describe('/dai-ly — mẫu đơn: lưu và xoá theo id', () => {
  const TPLS = [
    { id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] },
    { id: 'tp2', name: 'Đơn tuần', items: [{ variationId: 'v1', quantity: 1 }] },
  ];
  const del = (i: number) => buttons('Xoá mẫu đơn')[i]!;

  it('xoá cùng một mẫu hai lần cùng tick chỉ gọi DELETE một lần; mẫu khác vẫn xoá song song', async () => {
    const d1 = defer();
    m.del['/dealer/templates/tp1'] = () => d1.promise;
    setup({ '/dealer/templates': TPLS });
    await mount();
    sameTick(del(0), del(0));
    await flush();
    expect(dels('/dealer/templates/tp1')).toHaveLength(1);
    click(del(1));
    await flush();
    expect(dels('/dealer/templates/tp2')).toHaveLength(1);
    d1.resolve({ ok: true });
    await flush();
  });

  it('báo bận ở MỌI mẫu đang bay (không chỉ lệnh sau cùng), mẫu rảnh thì không; nút không disabled thật', async () => {
    const d1 = defer();
    const d2 = defer();
    m.del['/dealer/templates/tp1'] = () => d1.promise;
    m.del['/dealer/templates/tp2'] = () => d2.promise;
    setup({ '/dealer/templates': [...TPLS, { id: 'tp3', name: 'Đơn quý', items: [{ variationId: 'v1', quantity: 1 }] }] });
    await mount();
    click(del(0));
    await flush();
    expect([0, 1, 2].map((i) => busy(del(i)))).toEqual([true, false, false]);
    click(del(1));
    await flush();
    expect([0, 1, 2].map((i) => busy(del(i)))).toEqual([true, true, false]);
    expect(del(0).disabled).toBe(false);
    expect(del(0).getAttribute('aria-disabled')).toBe('true');
    d1.resolve({ ok: true });
    d2.resolve({ ok: true });
    await flush();
  });

  it('khoá giữ tới khi danh sách mẫu mới về: DELETE xong mà tải lại treo thì bấm lần hai vẫn bị chặn', async () => {
    setup({ '/dealer/templates': TPLS });
    await mount();
    const gate = holdGet('/dealer/templates');
    click(del(0));
    await flush();
    expect(dels('/dealer/templates/tp1')).toHaveLength(1);
    expect(busy(del(0))).toBe(true);
    click(del(0));
    await flush();
    expect(dels('/dealer/templates/tp1')).toHaveLength(1);
    m.data['/dealer/templates'] = [TPLS[1]];
    gate.release();
    await flush();
    expect(buttons('Xoá mẫu đơn')).toHaveLength(1);
  });

  it('xoá lỗi: role=alert, nhả khoá để thử lại', async () => {
    let n = 0;
    m.del['/dealer/templates/tp1'] = () => {
      n += 1;
      if (n === 1) throw new Error('Máy chủ bận');
      return { ok: true };
    };
    setup({ '/dealer/templates': TPLS });
    const c = await mount();
    click(del(0));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Máy chủ bận');
    expect(busy(del(0))).toBe(false);
    click(del(0));
    await flush();
    expect(dels('/dealer/templates/tp1')).toHaveLength(2);
  });

  describe('Lưu mẫu', () => {
    const openSheet = async () => {
      await mount();
      click(document.querySelector<HTMLButtonElement>('button[aria-label^="Tăng số lượng"]'));
      click(byText(document.body, 'button', 'Lưu mẫu'));
      await flush();
    };
    const save = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => /^(Lưu mẫu|Đang lưu…)$/.test(b.textContent ?? ''))!;
    const nameInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Tên mẫu"]')!;

    it('hai cú bấm cùng tick chỉ lưu một mẫu; hộp không đóng được bằng Esc khi đang lưu; nút aria-busy, KHÔNG disabled', async () => {
      const post = defer();
      m.post['/dealer/templates'] = () => post.promise;
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      sameTick(save(), save());
      await flush();
      expect(posts('/dealer/templates')).toHaveLength(1);
      expect(busy(save())).toBe(true);
      expect(save().disabled).toBe(false);
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      post.resolve({ id: 'tp9', name: 'Đơn tuần', items: [], createdAt: '' });
      await flush();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('gửi tên và các dòng lúc bấm; tên gõ khác trong lúc gửi không bị xoá, tên không đổi thì xoá', async () => {
      const post = defer();
      m.post['/dealer/templates'] = () => post.promise;
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      click(save());
      typeInto(nameInput(), 'Đơn tháng');
      post.resolve({ id: 'tp9', name: 'Đơn tuần', items: [], createdAt: '' });
      await flush();
      expect(posts('/dealer/templates')[0]!.body).toEqual({ name: 'Đơn tuần', items: [{ variationId: 'v1', quantity: 1 }] });
      click(byText(document.body, 'button', 'Lưu mẫu'));
      await flush();
      expect(nameInput().value).toBe('Đơn tháng');
    });

    it('lỗi: role=alert trong hộp, nhả khoá để lưu lại', async () => {
      let n = 0;
      m.post['/dealer/templates'] = () => {
        n += 1;
        if (n === 1) throw new Error('Tên mẫu đã có');
        return { id: 'tp9', name: 'Đơn tuần', items: [], createdAt: '' };
      };
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      click(save());
      await flush();
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Tên mẫu đã có');
      expect(busy(save())).toBe(false);
      click(save());
      await flush();
      expect(posts('/dealer/templates')).toHaveLength(2);
    });
  });
});

describe('/dai-ly — nhận thưởng theo (phần thưởng, kỳ)', () => {
  const R = () => setup({ '/dealer/rewards': { claimGraceDays: 30, rewards: [reward('rw1'), reward('rw2')] } });
  const claim = (i: number) => buttons(/^(Yêu cầu nhận thưởng|Đang gửi…)$/)[i]!;

  it('cùng một dòng hai cú bấm cùng tick chỉ một POST; dòng khác vẫn bấm được và độc lập', async () => {
    R();
    const p1 = defer();
    m.post['/dealer/rewards/rw1/claim'] = () => p1.promise;
    m.post['/dealer/rewards/rw2/claim'] = () => claimOk;
    await mount('tab=report');
    sameTick(claim(0), claim(0));
    await flush();
    expect(posts('/dealer/rewards/rw1/claim')).toHaveLength(1);
    click(claim(1));
    await flush();
    expect(posts('/dealer/rewards/rw2/claim')).toHaveLength(1);
    p1.resolve(claimOk);
    await flush();
  });

  it('báo bận ở mọi dòng đang bay; dòng rảnh thì không; nút không disabled thật', async () => {
    R();
    const p1 = defer();
    const p2 = defer();
    m.post['/dealer/rewards/rw1/claim'] = () => p1.promise;
    m.post['/dealer/rewards/rw2/claim'] = () => p2.promise;
    await mount('tab=report');
    click(claim(0));
    await flush();
    expect([busy(claim(0)), busy(claim(1))]).toEqual([true, false]);
    click(claim(1));
    await flush();
    expect([busy(claim(0)), busy(claim(1))]).toEqual([true, true]);
    expect(claim(0).disabled).toBe(false);
    p1.resolve(claimOk);
    p2.resolve(claimOk);
    await flush();
  });

  it('lỗi nhớ riêng theo dòng: dòng 1 lỗi SAU khi dòng 2 đã xong vẫn hiện role=alert ở dòng 1', async () => {
    R();
    const p1 = defer();
    m.post['/dealer/rewards/rw1/claim'] = () => p1.promise;
    m.post['/dealer/rewards/rw2/claim'] = () => claimOk;
    await mount('tab=report');
    click(claim(0));
    click(claim(1));
    await flush();
    p1.reject(new Error('Đã hết hạn nhận'));
    await flush();
    const rows = Array.from(document.querySelectorAll('section[aria-label="Phần thưởng đại lý"] li'));
    expect(rows[0]!.querySelector('[role="alert"]')?.textContent).toBe('Đã hết hạn nhận');
    expect(rows[1]!.querySelector('[role="alert"]')).toBeNull();
    expect(busy(claim(0))).toBe(false);
  });

  it('khoá giữ tới khi trạng thái thật về: lệnh lỗi mà tải lại thưởng treo thì bấm lại dòng đó vẫn bị chặn', async () => {
    R();
    let n = 0;
    m.post['/dealer/rewards/rw1/claim'] = () => {
      n += 1;
      if (n === 1) throw new Error('Tụt doanh số');
      return claimOk;
    };
    await mount('tab=report');
    const gate = holdGet('/dealer/rewards');
    click(claim(0));
    await flush();
    expect(posts('/dealer/rewards/rw1/claim')).toHaveLength(1);
    expect(busy(claim(0))).toBe(true);
    click(claim(0));
    await flush();
    expect(posts('/dealer/rewards/rw1/claim')).toHaveLength(1);
    gate.release();
    await flush();
    expect(busy(claim(0))).toBe(false);
    click(claim(0));
    await flush();
    expect(posts('/dealer/rewards/rw1/claim')).toHaveLength(2);
  });

  it('lỗi dòng được xoá khi bấm lại dòng đó', async () => {
    R();
    let n = 0;
    m.post['/dealer/rewards/rw1/claim'] = () => {
      n += 1;
      if (n === 1) throw new Error('Tụt doanh số');
      return claimOk;
    };
    await mount('tab=report');
    click(claim(0));
    await flush();
    expect(document.querySelector('section[aria-label="Phần thưởng đại lý"] [role="alert"]')?.textContent).toBe('Tụt doanh số');
    click(claim(0));
    await flush();
    expect(posts('/dealer/rewards/rw1/claim')).toHaveLength(2);
    expect(document.querySelector('section[aria-label="Phần thưởng đại lý"] [role="alert"]')).toBeNull();
  });
});

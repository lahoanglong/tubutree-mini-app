// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Lệnh của kênh đại lý bị máy chủ từ chối vì số liệu trên màn đã cũ (400/404/409/422): tải lại đúng khoá rồi mới nhả nút, như apps/miniapp/src/pages/dealer.tsx:411, 422, 536, 954 của Mini
// (isStaleStateError + settleWithin). Mất mạng, 401, 403, 5xx không nói gì về trạng thái thật nên không tải lại và nhả ngay.

type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };
type Deferred = { promise: Promise<unknown>; resolve: (v?: unknown) => void };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  getGate: {} as Record<string, () => Promise<unknown> | undefined>,
  post: {} as Record<string, () => unknown>,
  del: {} as Record<string, () => unknown>,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'DEALER' } }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, dealer: { maxDiscountPct: 0.45, reviewHours: 24 } }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dai-ly',
  useSearchParams: () => new URLSearchParams(globalThis.location?.search ?? ''),
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
const row = { variationId: 'v1', sku: 'POLANG-500', product: 'Nước rửa chén', brand: 'Pơ Lang', variation: '500ml', retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 9 };
const REPORT = {
  quarter: 'Q3/2026', periodStart: '', periodEnd: '', revenue: 1, orderCount: 1, pendingRevenue: 0, pendingOrderCount: 0,
  bonusPct: 0, bonusAmount: 0, nextTier: null, tiers: [],
};
const TPLS = [
  { id: 'tp1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] },
  { id: 'tp2', name: 'Đơn tuần', items: [{ variationId: 'v1', quantity: 1 }] },
];

const defer = (): Deferred => {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const holdGet = (...paths: string[]) => {
  const gate = defer();
  for (const p of paths) m.getGate[p] = () => gate.promise;
  return {
    release: () => {
      for (const p of paths) delete m.getGate[p];
      gate.resolve();
    },
  };
};

let mounted: Rendered[] = [];
const mount = async (search = '') => {
  window.history.replaceState(null, '', `/dai-ly${search}`);
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
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const sameTick = (...els: (HTMLElement | undefined)[]) =>
  act(() => {
    for (const el of els) el!.click();
  });
const amountInput = () => {
  const label = byText(document.body, 'label', 'Số tiền đã chuyển');
  return document.getElementById((label as HTMLLabelElement).htmlFor) as HTMLInputElement;
};
const alertText = () => Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join('|');

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
  vi.useRealTimers();
  mounted.forEach((x) => x.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

const REJECTIONS = [400, 404, 409, 422] as const;
const KEEP_AS_IS = [401, 403, 500, 503] as const;

describe('/dai-ly — báo đã chuyển khoản bị từ chối', () => {
  const open = () => mount('?tab=credit');
  const pay = () => buttons(/^(Báo đã chuyển khoản|Đang gửi…)$/)[0]!;
  const send = async (amount = '1000000') => {
    await open();
    typeInto(amountInput(), amount);
    const ledgerBefore = gets('/dealer/credit-ledger').length;
    const meBefore = gets('/dealer/me').length;
    return { ledgerBefore, meBefore };
  };

  it.each(REJECTIONS)('%i: lời lỗi hiện ngay, tải lại sổ công nợ và hồ sơ, nút giữ bận tới khi về; chạm lần hai không gửi', async (status) => {
    m.post['/dealer/credit-payment'] = () => {
      throw new ApiError('Số tiền báo vượt dư nợ hiện tại của bạn.', status);
    };
    const { ledgerBefore, meBefore } = await send();
    const gate = holdGet('/dealer/credit-ledger', '/dealer/me');
    click(pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(1);
    expect(alertText()).toContain('Số tiền báo vượt dư nợ');
    expect(gets('/dealer/credit-ledger').length).toBe(ledgerBefore + 1);
    expect(gets('/dealer/me').length).toBe(meBefore + 1);
    expect(busy(pay())).toBe(true);
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

  it.each(KEEP_AS_IS)('%i: không tải lại, nút nhả ngay', async (status) => {
    m.post['/dealer/credit-payment'] = () => {
      throw new ApiError('Máy chủ bận.', status);
    };
    const { ledgerBefore, meBefore } = await send();
    click(pay());
    await flush();
    expect(gets('/dealer/credit-ledger')).toHaveLength(ledgerBefore);
    expect(gets('/dealer/me')).toHaveLength(meBefore);
    expect(busy(pay())).toBe(false);
  });

  it('tải lại treo quá 4 giây thì nhả nút, không giữ mãi', async () => {
    m.post['/dealer/credit-payment'] = () => {
      throw new ApiError('Vượt dư nợ.', 400);
    };
    await send();
    holdGet('/dealer/credit-ledger', '/dealer/me');
    vi.useFakeTimers();
    click(pay());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(busy(pay())).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(busy(pay())).toBe(false);
  });

  it('tải lại nền hỏng: giữ sổ công nợ đang hiện, không thay bằng màn lỗi', async () => {
    m.post['/dealer/credit-payment'] = () => {
      throw new ApiError('Vượt dư nợ.', 409);
    };
    await send();
    m.getGate['/dealer/credit-ledger'] = async () => {
      throw new Error('Mất kết nối');
    };
    click(pay());
    await flush(8);
    expect(document.body.textContent).toContain('Dư nợ hiện tại');
    expect(buttons('Thử lại')).toHaveLength(0);
  });

  it('lỗi cũ biến mất khi bấm lại và lần này thành công', async () => {
    let n = 0;
    m.post['/dealer/credit-payment'] = () => {
      n += 1;
      if (n === 1) throw new ApiError('Máy chủ bận.', 503);
      return { ok: true };
    };
    await send();
    click(pay());
    await flush();
    expect(alertText()).toContain('Máy chủ đang bận');
    click(pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(2);
    expect(alertText()).toBe('');
  });

  it('số lẻ: nút khoá, không gửi (DTO IsInt trả 400 nhập liệu trước mọi kiểm tra trạng thái)', async () => {
    await send('1000.5');
    expect(pay().disabled).toBe(true);
    expect(document.body.textContent).toContain('Số tiền phải là số nguyên');
    click(pay());
    await flush();
    expect(posts('/dealer/credit-payment')).toHaveLength(0);
  });
});

describe('/dai-ly — mẫu đơn bị từ chối', () => {
  const del = (i: number) => buttons('Xoá mẫu đơn')[i]!;

  it.each(REJECTIONS)('xoá mẫu %i: lời lỗi hiện ngay, tải lại danh sách mẫu, nút giữ bận tới khi về rồi mẫu đã mất biến khỏi danh sách', async (status) => {
    m.del['/dealer/templates/tp1'] = () => {
      throw new ApiError('Không tìm thấy mẫu đơn.', status);
    };
    setup({ '/dealer/templates': TPLS });
    await mount();
    const before = gets('/dealer/templates').length;
    const gate = holdGet('/dealer/templates');
    click(del(0));
    await flush();
    expect(alertText()).toContain('Không tìm thấy mẫu đơn.');
    expect(gets('/dealer/templates').length).toBe(before + 1);
    expect(busy(del(0))).toBe(true);
    click(del(0));
    await flush();
    expect(dels('/dealer/templates/tp1')).toHaveLength(1);
    m.data['/dealer/templates'] = [TPLS[1]];
    gate.release();
    await flush();
    expect(buttons('Xoá mẫu đơn')).toHaveLength(1);
    expect(dels('/dealer/templates/tp1')).toHaveLength(1);
  });

  it.each(KEEP_AS_IS)('xoá mẫu %i: không tải lại, nhả ngay để thử lại', async (status) => {
    m.del['/dealer/templates/tp1'] = () => {
      throw new ApiError('Máy chủ bận.', status);
    };
    setup({ '/dealer/templates': TPLS });
    await mount();
    const before = gets('/dealer/templates').length;
    click(del(0));
    await flush();
    expect(gets('/dealer/templates')).toHaveLength(before);
    expect(busy(del(0))).toBe(false);
  });

  it('xoá mẫu: tải lại treo quá 4 giây thì nhả nút', async () => {
    m.del['/dealer/templates/tp1'] = () => {
      throw new ApiError('Không tìm thấy mẫu đơn.', 400);
    };
    setup({ '/dealer/templates': TPLS });
    await mount();
    holdGet('/dealer/templates');
    vi.useFakeTimers();
    click(del(0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(busy(del(0))).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(busy(del(0))).toBe(false);
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

    it.each(REJECTIONS)('%i: lời lỗi hiện ngay trong hộp, tải lại danh sách mẫu, nút giữ bận tới khi về', async (status) => {
      m.post['/dealer/templates'] = () => {
        throw new ApiError('Mẫu đơn trống.', status);
      };
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      const before = gets('/dealer/templates').length;
      const gate = holdGet('/dealer/templates');
      click(save());
      await flush();
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Mẫu đơn trống.');
      expect(gets('/dealer/templates').length).toBe(before + 1);
      expect(busy(save())).toBe(true);
      click(save());
      await flush();
      expect(posts('/dealer/templates')).toHaveLength(1);
      gate.release();
      await flush();
      expect(busy(save())).toBe(false);
    });

    it('tải lại treo quá 4 giây thì nhả nút', async () => {
      m.post['/dealer/templates'] = () => {
        throw new ApiError('Mẫu đơn trống.', 400);
      };
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      holdGet('/dealer/templates');
      vi.useFakeTimers();
      click(save());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(busy(save())).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(busy(save())).toBe(false);
    });

    it('lời lỗi cũ biến mất ngay khi bấm lưu lại (lúc lệnh mới còn bay)', async () => {
      let n = 0;
      const second = defer();
      m.post['/dealer/templates'] = () => {
        n += 1;
        if (n === 1) throw new ApiError('Máy chủ bận.', 503);
        return second.promise;
      };
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      click(save());
      await flush();
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Máy chủ đang bận');
      click(save());
      await flush();
      expect(posts('/dealer/templates')).toHaveLength(2);
      expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
      second.resolve({ id: 'tp9', name: 'Đơn tuần', items: [], createdAt: '' });
      await flush();
    });

    it('lỗi 500: không tải lại, nhả ngay', async () => {
      m.post['/dealer/templates'] = () => {
        throw new ApiError('Máy chủ bận.', 500);
      };
      await openSheet();
      typeInto(nameInput(), 'Đơn tuần');
      const before = gets('/dealer/templates').length;
      click(save());
      await flush();
      expect(gets('/dealer/templates')).toHaveLength(before);
      expect(busy(save())).toBe(false);
    });

    it('ô tên giới hạn 120 ký tự như DTO (SaveTemplateDto.name), không để tới 400 nhập liệu', async () => {
      await openSheet();
      expect(nameInput().maxLength).toBe(120);
    });
  });
});

describe('/dai-ly — đặt đơn bị từ chối', () => {
  const addOne = () => click(document.querySelector<HTMLButtonElement>('button[aria-label^="Tăng số lượng"]'));
  const ghi = () => buttons(/^(Ghi công nợ|Đang đặt…)$/);
  const READ_KEYS = ['/dealer/orders', '/dealer/me', '/dealer/credit-ledger', '/dealer/rewards', '/dealer/quarterly-report', '/dealer/pricelist'];
  const countAll = () => Object.fromEntries(READ_KEYS.map((k) => [k, gets(k).length]));

  it.each(REJECTIONS)('%i: lời lỗi hiện ngay, tải lại đơn, hồ sơ, công nợ, thưởng, báo cáo và bảng giá, nút giữ bận tới khi về; cùng Idempotency-Key khi bấm lại', async (status) => {
    let n = 0;
    m.post['/dealer/orders'] = () => {
      n += 1;
      if (n === 1) throw new ApiError('Vượt hạn mức công nợ.', status);
      return { code: 'TUBU2', items: [] };
    };
    await mount();
    addOne();
    const before = countAll();
    const gate = holdGet(...READ_KEYS);
    click(ghi()[0]!);
    await flush();
    expect(alertText()).toContain('Vượt hạn mức công nợ.');
    // Chỉ truy vấn đang hiện trên màn mới được tải lại ngay (các tab khác chỉ bị đánh dấu cũ): bảng giá và hồ sơ luôn nằm trong số đó.
    const active = READ_KEYS.filter((k) => before[k]! > 0);
    expect(active).toEqual(expect.arrayContaining(['/dealer/pricelist', '/dealer/me']));
    for (const k of active) expect(gets(k).length, k).toBe(before[k]! + 1);
    expect(busy(ghi()[0]!)).toBe(true);
    sameTick(ghi()[0], ghi()[0]);
    await flush();
    expect(posts('/dealer/orders')).toHaveLength(1);
    gate.release();
    await flush();
    expect(busy(ghi()[0]!)).toBe(false);
    click(ghi()[0]!);
    await flush();
    const keys = posts('/dealer/orders').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it.each(KEEP_AS_IS)('%i: không tải lại, nhả ngay để bấm lại', async (status) => {
    m.post['/dealer/orders'] = () => {
      throw new ApiError('Máy chủ bận.', status);
    };
    await mount();
    addOne();
    const before = countAll();
    click(ghi()[0]!);
    await flush();
    expect(countAll()).toEqual(before);
    expect(busy(ghi()[0]!)).toBe(false);
  });

  it('tải lại treo quá 4 giây thì nhả nút', async () => {
    m.post['/dealer/orders'] = () => {
      throw new ApiError('Vượt hạn mức.', 409);
    };
    await mount();
    addOne();
    holdGet(...READ_KEYS);
    vi.useFakeTimers();
    click(ghi()[0]!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(busy(ghi()[0]!)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(busy(ghi()[0]!)).toBe(false);
  });
});

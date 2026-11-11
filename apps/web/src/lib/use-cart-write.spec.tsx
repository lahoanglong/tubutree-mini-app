// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { cartKey } from '@/lib/cart-key';
import type { CartSummary } from '@/lib/shop-client';
import { subscribeDroppedCart, useCartWrite } from './use-cart-write';
import { useRemovedCoupon } from './use-removed-coupon';

// Sổ lệnh giỏ theo QueryClient: lệnh đi một mình ghi thẳng phản hồi; lệnh từng chồng với việc khác bỏ phản hồi và tải lại giỏ MỘT lần sau khi mọi lệnh xong.

const state = vi.hoisted(() => ({ gets: 0, serverCart: null as unknown, gate: null as null | Promise<void> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));

const cartOf = (mark: string) => ({ items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0, mark }) as unknown as CartSummary;
const mark = (client: QueryClient) => (client.getQueryData(cartKey()) as { mark?: string } | undefined)?.mark;

type Api = ReturnType<typeof useCartWrite>;
const out: { api?: Api } = {};
function Probe() {
  out.api = useCartWrite();
  // Người quan sát giỏ đang hoạt động: tải lại giỏ thấy được qua `state.gets`.
  useQuery({
    queryKey: cartKey(),
    queryFn: async () => {
      state.gets += 1;
      const snapshot = state.serverCart;
      if (state.gate) await state.gate;
      return snapshot;
    },
  });
  return null;
}

let client: QueryClient;
let mounted: Rendered | null = null;
const mountWith = async (c: QueryClient) => {
  mounted = render(<Probe />, c);
  await flush(4);
};
const api = () => out.api!;
// Không đợi lời hứa `fn` trả về: lời hứa tải lại chủ ý treo tới khi lệnh khác xong (hoặc hết hạn chờ), và từng test tự kiểm lúc đó.
const run = async (fn: () => unknown) => {
  await act(async () => {
    fn();
  });
};

beforeEach(() => {
  state.gets = 0;
  state.serverCart = cartOf('máy chủ');
  state.gate = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});
afterEach(() => {
  vi.useRealTimers();
  mounted?.unmount();
  mounted = null;
});

describe('useCartWrite: lệnh đi một mình', () => {
  it('ghi thẳng phản hồi vào cache, không tải lại, không trả lời hứa', async () => {
    await mountWith(client);
    const gets = state.gets;
    const cmd = api().begin();
    expect(cmd.stale).toBe(false);
    let held: Promise<void> | undefined;
    await run(() => {
      held = api().write(cmd, cartOf('phản hồi'));
    });
    expect(held).toBeUndefined();
    expect(mark(client)).toBe('phản hồi');
    expect(state.gets).toBe(gets);
  });

  it('hai lệnh nối tiếp (lệnh sau bắt đầu khi lệnh trước đã xong) đều ghi thẳng', async () => {
    await mountWith(client);
    const gets = state.gets;
    const a = api().begin();
    await run(() => api().write(a, cartOf('A')));
    const b = api().begin();
    expect(b.stale).toBe(false);
    await run(() => api().write(b, cartOf('B')));
    expect(mark(client)).toBe('B');
    expect(state.gets).toBe(gets);
  });
});

describe('useCartWrite: lần tải giỏ đang bay lúc phản hồi về', () => {
  // Lần tải đã gửi TRƯỚC khi máy chủ xử lý lệnh sẽ về với giỏ cũ: ghi thẳng phản hồi rồi để nó về muộn là đè giỏ mới bằng giỏ cũ.
  const startLoad = async () => {
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await run(() => void client.refetchQueries({ queryKey: cartKey() }));
    return release;
  };

  it('lệnh đi một mình nhưng giỏ đang tải: bỏ phản hồi, tải lại; bản tải cũ về muộn không đè giỏ sau lệnh', async () => {
    await mountWith(client);
    state.serverCart = cartOf('trước lệnh');
    const release = await startLoad();
    const gets = state.gets;
    const cmd = api().begin();
    expect(cmd.stale).toBe(false);
    state.serverCart = cartOf('sau lệnh');
    let held: Promise<void> | undefined;
    await run(() => {
      held = api().write(cmd, cartOf('phản hồi'));
    });
    expect(held).toBeDefined();
    await run(() => release());
    await flush(6);
    expect(state.gets).toBe(gets + 1);
    expect(mark(client)).toBe('sau lệnh');
  });

  it('lệnh đã được tính là cũ vì lần tải đang bay: lệnh kế tiếp vẫn đi một mình khi mọi thứ đã yên', async () => {
    await mountWith(client);
    const release = await startLoad();
    const a = api().begin();
    await run(() => api().write(a, cartOf('A')));
    await run(() => release());
    await flush(6);
    const b = api().begin();
    expect(b.stale).toBe(false);
    await run(() => api().write(b, cartOf('B')));
    expect(mark(client)).toBe('B');
  });

  it('truy vấn con của giỏ (vd phần chọn thanh toán) đang tải không làm lệnh thành cũ: chỉ khoá giỏ chính xác mới tính', async () => {
    await mountWith(client);
    const gets = state.gets;
    let finish!: () => void;
    const child = new Promise<{ ok: true }>((resolve) => {
      finish = () => resolve({ ok: true });
    });
    void client.fetchQuery({ queryKey: [...cartKey(), 'selection'], queryFn: () => child });
    const cmd = api().begin();
    let held: Promise<void> | undefined;
    await run(() => {
      held = api().write(cmd, cartOf('phản hồi'));
    });
    expect(held).toBeUndefined();
    expect(mark(client)).toBe('phản hồi');
    expect(state.gets).toBe(gets);
    finish();
  });
});

describe('useCartWrite: lệnh chồng nhau', () => {
  let release!: () => void;

  it('cả hai lệnh thành cũ, không ghi phản hồi nào; lệnh xong cuối cùng tải lại giỏ đúng MỘT lần và cả hai lời hứa chỉ xong sau lần tải đó', async () => {
    await mountWith(client);
    client.setQueryData(cartKey(), cartOf('cũ'));
    const gets = state.gets;
    const a = api().begin();
    const b = api().begin();
    expect(a.stale).toBe(true);
    expect(b.stale).toBe(true);
    let heldA: Promise<void> | undefined;
    let heldB: Promise<void> | undefined;
    let doneA = false;
    let doneB = false;
    await run(() => {
      heldA = api().write(a, cartOf('A'));
      void heldA!.then(() => (doneA = true));
    });
    expect(mark(client)).toBe('cũ');
    expect(state.gets).toBe(gets);
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.gate = gate;
    await run(() => {
      heldB = api().write(b, cartOf('B'));
      void heldB!.then(() => (doneB = true));
    });
    await flush(2);
    expect(state.gets).toBe(gets + 1);
    expect(mark(client)).toBe('cũ');
    expect(doneA || doneB).toBe(false);
    await run(() => release());
    await flush(4);
    expect(doneA && doneB).toBe(true);
    expect(mark(client)).toBe('máy chủ');
    expect(state.gets).toBe(gets + 1);
  });

  it('lệnh bắt đầu sau khi lệnh kia đã xong nhưng lệnh thứ ba còn bay: vẫn là chồng (thành cũ)', async () => {
    await mountWith(client);
    const a = api().begin();
    const b = api().begin();
    await run(() => api().write(a, cartOf('A')));
    const c = api().begin();
    expect(c.stale).toBe(true);
    expect(b.stale).toBe(true);
  });

  it('lệnh A xong một mình sau khi B (chồng với nó) đã xong trước: A vẫn thành cũ (bỏ phản hồi), vì B đã chồng lên đời của A', async () => {
    await mountWith(client);
    client.setQueryData(cartKey(), cartOf('cũ'));
    const a = api().begin();
    const b = api().begin();
    await run(() => api().write(b, cartOf('B')));
    await run(() => api().write(a, cartOf('A')));
    expect(mark(client)).toBe('máy chủ');
  });

  it('lệnh lỗi trả lại chỗ trong sổ: lệnh kia xong thì tải lại một lần; lệnh kế tiếp đi một mình và ghi thẳng', async () => {
    await mountWith(client);
    const gets = state.gets;
    const a = api().begin();
    const b = api().begin();
    await run(() => api().fail(b));
    await run(() => api().write(a, cartOf('A')));
    await flush(4);
    expect(state.gets).toBe(gets + 1);
    const c = api().begin();
    expect(c.stale).toBe(false);
    await run(() => api().write(c, cartOf('C')));
    expect(mark(client)).toBe('C');
    expect(state.gets).toBe(gets + 1);
  });

  it('lệnh lỗi đi một mình không tải lại và không để lại dấu: lệnh sau ghi thẳng', async () => {
    await mountWith(client);
    const gets = state.gets;
    const a = api().begin();
    let held: Promise<void> | undefined;
    await run(() => {
      held = api().fail(a);
    });
    expect(held).toBeUndefined();
    expect(state.gets).toBe(gets);
    const b = api().begin();
    expect(b.stale).toBe(false);
  });

  it('end chạy lại nhiều lần không trả chỗ của lệnh khác: write rồi fail cùng một lệnh', async () => {
    await mountWith(client);
    const a = api().begin();
    const b = api().begin();
    await run(() => api().write(a, cartOf('A')));
    await run(() => api().fail(a));
    await run(() => api().fail(a));
    const c = api().begin();
    expect(c.stale).toBe(true);
    await run(() => api().fail(b));
    await run(() => api().fail(c));
    expect(api().begin().stale).toBe(false);
  });

  it('fail(undefined) không ném lỗi', async () => {
    await mountWith(client);
    await run(() => api().fail(undefined));
    await run(() => api().fail(undefined, true));
  });
});

describe('useCartWrite + useRemovedCoupon: lời báo mã bị gỡ nằm trong phản hồi bị bỏ', () => {
  const fmt = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
  const line = (total: number, isFlash = false) => ({ id: `l${total}`, total, isFlash });
  const cartWith = (goods: number, extra: Record<string, unknown> = {}) =>
    ({ ...cartOf(`giỏ ${goods}`), items: [line(goods)], subtotal: goods, couponCode: null, ...extra }) as unknown as CartSummary;
  const removed = { code: 'GIAM30', reason: 'MIN_ORDER', shortfall: 80_000 };
  const notice: { current: ReturnType<typeof useRemovedCoupon> | null } = { current: null };

  // Người xem giỏ thật của trang giỏ: đọc cache bằng `useQuery` rồi đưa cho `useRemovedCoupon`, nên chữ lời báo là chữ khách thấy.
  function NoticeProbe() {
    out.api = useCartWrite();
    const q = useQuery({
      queryKey: cartKey(),
      queryFn: async () => {
        state.gets += 1;
        const snapshot = state.serverCart;
        if (state.gate) await state.gate;
        return snapshot as CartSummary;
      },
    });
    notice.current = useRemovedCoupon(q.data, fmt);
    return null;
  }
  const mountNotice = async (seed: CartSummary) => {
    client.setQueryData(cartKey(), seed);
    mounted = render(<NoticeProbe />, client);
    await flush(4);
  };
  const text = () => notice.current?.notice?.text ?? null;

  // Lệnh A bị máy chủ gỡ mã (giỏ còn 220k < 300k): phản hồi của A mang `couponRemoved`, chỉ có ở đúng phản hồi đó. Lệnh B chồng lên A nên A thành cũ.
  // Lần tải lại giữ tới khi trang đã vẽ xong phản hồi bị bỏ: lời báo phải nhớ đúng số ngay lúc đó chứ không chờ giỏ mới.
  const dropResponseOfA = async (response: CartSummary) => {
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = api().begin();
    const b = api().begin();
    await run(() => api().write(b, cartWith(220_000)));
    await run(() => api().write(a, response));
    await flush(4);
    await run(() => release());
    state.gate = null;
    await flush(6);
  };

  it('số thiếu tính theo phần hàng của PHẢN HỒI mang lời báo (220k), không theo giỏ cũ trong cache (300k)', async () => {
    state.serverCart = cartWith(220_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    await dropResponseOfA(cartWith(220_000, { couponRemoved: removed }));
    expect(mark(client)).toBe('giỏ 220000');
    expect(text()).toBe('Đã gỡ mã GIAM30 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 80.000đ để dùng lại.');
  });

  it('chiều ngược: lần tải lại về giỏ đã có thêm hàng (300k) thì lời báo chuyển sang "đủ", không còn đòi mua thêm', async () => {
    state.serverCart = cartWith(300_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    await dropResponseOfA(cartWith(220_000, { couponRemoved: removed }));
    expect(text()).toBe('Giỏ đã đủ đơn tối thiểu của mã GIAM30. Bấm Chọn mã để dùng lại.');
  });

  it('lý do không phải đơn tối thiểu (không có số thiếu): giữ nguyên câu lý do của máy chủ', async () => {
    state.serverCart = cartWith(220_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    await dropResponseOfA(cartWith(220_000, { couponRemoved: { code: 'GIAM30', reason: 'Mã đã hết hạn.' } }));
    expect(text()).toBe('Đã gỡ mã GIAM30: Mã đã hết hạn.');
  });

  it('phản hồi bị bỏ không mang `couponRemoved`: không có lời báo, và lời báo đã nhớ không bị xoá', async () => {
    state.serverCart = cartWith(220_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    await dropResponseOfA(cartWith(220_000, { couponRemoved: removed }));
    expect(text()).not.toBeNull();
    await dropResponseOfA(cartWith(220_000, { couponCode: 'KHAC' }));
    expect(text()).toContain('Mua thêm 80.000đ');
  });

  it('cả hai lệnh cùng một lượt act với lần tải lại: vẫn nhớ lời báo', async () => {
    state.serverCart = cartWith(220_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    const a = api().begin();
    const b = api().begin();
    await act(async () => {
      void api().write(b, cartWith(220_000));
      void api().write(a, cartWith(220_000, { couponRemoved: removed }));
    });
    await flush(6);
    expect(text()).toBe('Đã gỡ mã GIAM30 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 80.000đ để dùng lại.');
  });

  it('khách đóng lời báo: mất, và lần tải lại sau đó không dựng lại', async () => {
    state.serverCart = cartWith(220_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    await dropResponseOfA(cartWith(220_000, { couponRemoved: removed }));
    await act(async () => notice.current!.dismiss());
    expect(text()).toBeNull();
    await act(async () => void client.invalidateQueries({ queryKey: ['cart'] }));
    await flush(6);
    expect(text()).toBeNull();
  });

  it('phản hồi bị bỏ không đụng vào giỏ trong cache: phần còn lại của giỏ do lần tải lại quyết định', async () => {
    state.serverCart = cartWith(220_000);
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    const a = api().begin();
    api().begin();
    state.gate = new Promise<void>(() => {});
    await run(() => api().write(a, cartWith(220_000, { couponRemoved: removed })));
    expect(mark(client)).toBe('giỏ 300000');
    expect((client.getQueryData(cartKey()) as { couponRemoved?: unknown }).couponRemoved).toBeUndefined();
  });

  it('lệnh đi một mình có `couponRemoved`: ghi thẳng vào giỏ và lời báo hiện từ giỏ đó, đúng số', async () => {
    await mountNotice(cartWith(300_000, { couponCode: 'GIAM30' }));
    const a = api().begin();
    await run(() => api().write(a, cartWith(220_000, { couponRemoved: removed })));
    await flush(2);
    expect(text()).toBe('Đã gỡ mã GIAM30 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 80.000đ để dùng lại.');
  });
});

describe('subscribeDroppedCart', () => {
  it('nhận phản hồi bị bỏ, không nhận phản hồi ghi thẳng, và hết nhận sau khi huỷ đăng ký', async () => {
    await mountWith(client);
    const heard: unknown[] = [];
    const off = subscribeDroppedCart(client, (cart) => heard.push(cart));
    const lone = api().begin();
    await run(() => api().write(lone, cartOf('đi một mình')));
    expect(heard).toEqual([]);
    const a = api().begin();
    api().begin();
    const response = cartOf('A');
    await run(() => api().write(a, response));
    expect(heard).toEqual([response]);
    off();
    const c = api().begin();
    await run(() => api().write(c, cartOf('C')));
    expect(heard).toHaveLength(1);
  });

  it('mọi người nghe của cùng QueryClient đều nhận phản hồi bị bỏ, theo thứ tự đăng ký', async () => {
    await mountWith(client);
    const heard: string[] = [];
    const offA = subscribeDroppedCart(client, () => heard.push('A'));
    const offB = subscribeDroppedCart(client, () => heard.push('B'));
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, cartOf('A')));
    expect(heard).toEqual(['A', 'B']);
    offA();
    offB();
  });

  it('theo từng QueryClient: lệnh của client khác không đánh thức người nghe', async () => {
    await mountWith(client);
    const other = new QueryClient();
    const heard: unknown[] = [];
    const off = subscribeDroppedCart(other, (cart) => heard.push(cart));
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, cartOf('A')));
    expect(heard).toEqual([]);
    off();
  });

  it('huỷ đăng ký hai lần không ném lỗi và không gỡ người nghe khác', async () => {
    await mountWith(client);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const offFirst = subscribeDroppedCart(client, (cart) => first.push(cart));
    const offSecond = subscribeDroppedCart(client, (cart) => second.push(cart));
    offFirst();
    offFirst();
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, cartOf('A')));
    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
    offSecond();
  });
});

describe('useCartWrite: tải lại giỏ', () => {
  it('fail(lệnh, true) khi không còn lệnh nào bay: tải ngay, lời hứa xong sau lần tải', async () => {
    await mountWith(client);
    const gets = state.gets;
    const a = api().begin();
    let done = false;
    await run(() => {
      void api().fail(a, true)!.then(() => (done = true));
    });
    await flush(2);
    expect(state.gets).toBe(gets + 1);
    expect(done).toBe(true);
  });

  it('fail(lệnh, true) khi còn lệnh khác bay: chưa tải; lệnh kia xong mới tải một lần', async () => {
    await mountWith(client);
    const gets = state.gets;
    const a = api().begin();
    const b = api().begin();
    await run(() => api().fail(b, true));
    await flush(2);
    expect(state.gets).toBe(gets);
    await run(() => api().write(a, cartOf('A')));
    await flush(4);
    expect(state.gets).toBe(gets + 1);
  });

  it('reload() không do lệnh nào gây ra: chờ lệnh đang bay xong rồi tải, và tải ngay khi không có lệnh nào', async () => {
    await mountWith(client);
    const gets = state.gets;
    await run(() => api().reload());
    expect(state.gets).toBe(gets + 1);
    const a = api().begin();
    await run(() => void api().reload());
    await flush(2);
    expect(state.gets).toBe(gets + 1);
    await run(() => api().write(a, cartOf('A')));
    await flush(4);
    expect(state.gets).toBe(gets + 2);
  });

  it('lệnh bay quá 4 giây: lần tải vẫn chạy (không chờ mãi), lời hứa xong, và lệnh còn bay thành cũ', async () => {
    await mountWith(client);
    const gets = state.gets;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = api().begin();
    let done = false;
    await run(() => {
      void api().reload().then(() => (done = true));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(state.gets).toBe(gets);
    expect(done).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(state.gets).toBe(gets + 1);
    expect(done).toBe(true);
    expect(a.stale).toBe(true);
    vi.useRealTimers();
    client.setQueryData(cartKey(), cartOf('cũ'));
    await run(() => api().write(a, cartOf('A muộn')));
    expect(mark(client)).not.toBe('A muộn');
  });

  it('nhiều bên chờ cùng lúc chỉ gây MỘT lần tải, kể cả khi hết hạn chờ', async () => {
    await mountWith(client);
    const gets = state.gets;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api().begin();
    await run(() => {
      void api().reload();
      void api().reload();
      void api().fail(undefined, true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(state.gets).toBe(gets + 1);
  });

  it('hạn chờ tính từ lần chờ hiện tại: lần chờ sau không bị hạn của lần chờ trước (đã xong) cắt ngắn, và vẫn có hạn riêng', async () => {
    await mountWith(client);
    const gets = state.gets;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = api().begin();
    await run(() => void api().reload());
    await run(() => api().write(first, cartOf('A')));
    expect(state.gets).toBe(gets + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    api().begin();
    await run(() => void api().reload());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(state.gets).toBe(gets + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(state.gets).toBe(gets + 2);
  });

  it('lệnh bắt đầu lúc lần tải (do cơ chế này khởi động) còn đang chạy thành cũ; lần tải xong thì lệnh sau ghi thẳng', async () => {
    await mountWith(client);
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await run(() => void api().reload());
    await flush(2);
    const during = api().begin();
    expect(during.stale).toBe(true);
    state.gate = null;
    await run(() => api().fail(during));
    await run(() => release());
    await flush(4);
    expect(api().begin().stale).toBe(false);
  });
});

describe('useCartWrite: sổ theo QueryClient', () => {
  it('hai QueryClient không thấy lệnh của nhau', async () => {
    await mountWith(client);
    const a = api().begin();
    const other = new QueryClient();
    mounted!.unmount();
    mounted = render(<Probe />, other);
    await flush(4);
    expect(api().begin().stale).toBe(false);
    expect(a.stale).toBe(false);
  });

  it('lệnh của lần dựng cũ vẫn tính khi component dựng lại trên cùng QueryClient', async () => {
    await mountWith(client);
    const a = api().begin();
    mounted!.unmount();
    await mountWith(client);
    const b = api().begin();
    expect(b.stale).toBe(true);
    expect(a.stale).toBe(true);
  });
});

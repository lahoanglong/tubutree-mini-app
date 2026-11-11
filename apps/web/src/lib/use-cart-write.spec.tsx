// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { cartKey } from '@/lib/cart-key';
import type { CartSummary } from '@/lib/shop-client';
import { useCartWrite } from './use-cart-write';

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

describe('useCartWrite: lời báo mã bị gỡ trong phản hồi bị bỏ', () => {
  const removed = { code: 'GIAM30', reason: 'MIN_ORDER', shortfall: 50000 };

  it('phản hồi bị bỏ mà mang `couponRemoved` (chỉ có ở đúng lần đọc làm máy chủ gỡ mã): giữ lời báo ở giỏ trong cache, phần còn lại của giỏ không ghi đè', async () => {
    await mountWith(client);
    client.setQueryData(cartKey(), cartOf('cũ'));
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, { ...cartOf('A'), couponRemoved: removed }));
    const now = client.getQueryData(cartKey()) as { mark?: string; couponRemoved?: unknown };
    expect(now.mark).toBe('cũ');
    expect(now.couponRemoved).toEqual(removed);
  });

  it('phản hồi bị bỏ không có `couponRemoved`: cache giữ nguyên', async () => {
    await mountWith(client);
    client.setQueryData(cartKey(), cartOf('cũ'));
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, cartOf('A')));
    expect(mark(client)).toBe('cũ');
    expect((client.getQueryData(cartKey()) as { couponRemoved?: unknown }).couponRemoved).toBeUndefined();
  });

  it('phản hồi bị bỏ không mang `couponRemoved`: không xoá lời báo đang có trong cache', async () => {
    await mountWith(client);
    client.setQueryData(cartKey(), { ...cartOf('cũ'), couponRemoved: removed });
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, cartOf('A')));
    expect((client.getQueryData(cartKey()) as { couponRemoved?: unknown }).couponRemoved).toEqual(removed);
  });

  it('chưa có giỏ trong cache: không dựng giỏ rỗng từ lời báo', async () => {
    await mountWith(client);
    client.removeQueries({ queryKey: cartKey() });
    const a = api().begin();
    api().begin();
    await run(() => api().write(a, { ...cartOf('A'), couponRemoved: removed }));
    expect(client.getQueryData(cartKey())).toBeUndefined();
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

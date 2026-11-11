// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement, type ReactNode } from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { flush, remount, render, typeInto, type Rendered } from '@/test-utils/dom';

// Wave 100B: 7 lệnh ghi của tấm gian hàng CTV (chọn mẫu, tạo trống, thêm sản phẩm, hồ sơ, cấu hình, gỡ ngân hàng, đổi tên khối).
// Mỗi lệnh: chạm đúp chỉ gửi một lần (kể cả sau khi tấm dựng lại lúc lệnh còn bay), giữ khoá tới khi dữ liệu mới về (tối đa 4 giây),
// bị máy chủ từ chối vì trạng thái đã đổi thì tải lại ĐÚNG khoá rồi mới nhả khoá, lỗi tạm thì không tải lại.

type Call = { method: string; path: string; body?: unknown; query?: unknown };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  /** `method path` → mã HTTP làm lệnh/lần tải thất bại (0 = mất mạng, không có mã). */
  status: new Map<string, number>(),
  gates: new Map<string, Promise<void>>(),
  hang: new Set<string>(),
  sf: null as Record<string, unknown> | null,
  picker: [] as unknown[],
  categories: [] as unknown[],
}));

function httpError(status: number) {
  const message = status === 0 ? 'Mất kết nối giả' : `Lời máy chủ ${status}`;
  return status === 0 ? new Error(message) : Object.assign(new Error(message), { status });
}

vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, query?: unknown) => {
    state.calls.push({ method, path, body, query });
    const key = `${method} ${path}`;
    if (state.hang.has(key)) return new Promise(() => {});
    const gate = state.gates.get(key);
    if (gate) await gate;
    const status = state.status.get(key);
    if (status !== undefined) throw httpError(status);
    if (method === 'get') {
      if (path === '/storefront/me') return state.sf;
      if (path === '/storefront/me/quests') return { quests: [], totalEarnedPoints: 0, level: 1, levelMax: 5 };
      if (path === '/storefront/me/products') return state.picker;
      if (path === '/categories') return state.categories;
    }
    if (method === 'post' && path === '/storefront/me/apply-template') return { collectionId: 'c9', title: 'Nhà bếp', itemCount: 8 };
    return { id: 'x', ok: true };
  };
  return {
    coreHttp: {
      get: (p: string, o?: { query?: unknown }) => run('get', p, undefined, o?.query),
      post: (p: string, b?: unknown) => run('post', p, b),
      patch: (p: string, b?: unknown) => run('patch', p, b),
      delete: (p: string) => run('delete', p),
      put: (p: string, b?: unknown) => run('put', p, b),
    },
  };
});

import { STOREFRONT_TEMPLATE_BUSY } from '@tubutree/app-core/client-copy';
import { myStorefrontQuery, storefrontQuestsQuery } from '@tubutree/app-core/queries/storefront';
import type { StorefrontCollectionEdit, StorefrontEdit } from '@tubutree/app-core/api/storefront';
import { coreHttp } from '@/lib/core-http';
import { settleWithin } from '@/lib/settle-within';
import { CollectionSheet, ConfigSheet, PickerSheet, ProfileSheet, TemplateSheet } from './storefront-sheets';
import { STOREFRONT_THEME_COLORS } from './storefront-theme';

const SF = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: 'Mua giúp mình nhé', avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
  subdomain: null, subdomainEnabled: false, isPublished: false, collections: [], ...over,
});
const asSf = (over: Record<string, unknown> = {}) => SF(over) as unknown as StorefrontEdit;
const COLLECTION = { id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] } as unknown as StorefrontCollectionEdit;
const PRODUCT = (id: string, name: string) => ({ id, name, slug: id, thumbnail: null, brand: 'Tubu', basePrice: 100_000, salePrice: 80_000, ratingAvg: 5, reviewCount: 1, maxAffiliateRate: 12 });

let qc: QueryClient;
let mounted: Rendered | null = null;
/** Bật thì lời gọi `onSaved/onAdded/onCreated` của test KHÔNG tự giới hạn 4 giây: chỉ tấm tự giới hạn được. */
let uncapped = false;

/** Giống `refresh` của trình dựng: tải lại gian hàng, trả Promise. */
const refresh = () => (uncapped ? qc.invalidateQueries({ queryKey: ['my-storefront'] }) : settleWithin(qc.invalidateQueries({ queryKey: ['my-storefront'] })));

function Host({ children }: { children: ReactNode }) {
  useQuery(myStorefrontQuery(coreHttp));
  useQuery(storefrontQuestsQuery(coreHttp));
  return <>{children}</>;
}

/** Như trang cha: `sf` lấy từ bộ nhớ đệm nên đổi khi lần tải lại về (khác `asSf()` cố định, vốn không bao giờ cho thấy tải lại làm gì với form). */
function LiveSf({ children }: { children: (sf: StorefrontEdit) => ReactElement }) {
  const q = useQuery(myStorefrontQuery(coreHttp));
  return q.data ? children(q.data as unknown as StorefrontEdit) : null;
}
const cachedSf = () => qc.getQueryData(myStorefrontQuery(coreHttp).queryKey) as { title?: string; themeColor?: string | null } | undefined;

const noop = () => {};
const ME = 'get /storefront/me';
const QUESTS = 'get /storefront/me/quests';
const PICKER = 'get /storefront/me/products';
const CATEGORIES = 'get /categories';
const PATCH_ME = 'patch /storefront/me';

/** Nút theo tên truy cập (aria-label hoặc chữ), khớp nguyên văn một trong các tên (nút bận đổi chữ), trong thân hộp thoại. */
function btn(...names: string[]): HTMLElement {
  const dialog = document.body.querySelector('[role="dialog"]') ?? document.body;
  const hit = Array.from(dialog.querySelectorAll<HTMLElement>('button')).find((e) => names.includes((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()));
  if (!hit) throw new Error(`không thấy nút "${names.join('" / "')}"`);
  return hit;
}
const inputByLabel = (label: string) => document.body.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? '');
const gets = (key: string) => state.calls.filter((c) => `${c.method} ${c.path}` === key).length;
const writes = gets;
const tap = async (el: HTMLElement, n = 1) => {
  act(() => {
    for (let i = 0; i < n; i += 1) el.click();
  });
  await flush();
};
const hold = (key: string) => {
  let release!: () => void;
  state.gates.set(key, new Promise<void>((r) => { release = r; }));
  return async () => {
    state.gates.delete(key);
    await act(async () => release());
    await flush();
  };
};
const expectBusy = (el: HTMLElement) => {
  expect(el.getAttribute('aria-busy')).toBe('true');
  expect(el.getAttribute('aria-disabled')).toBe('true');
  expect((el as HTMLButtonElement).disabled).toBe(false);
};
const expectIdle = (el: HTMLElement) => {
  expect(el.hasAttribute('aria-busy')).toBe(false);
  expect(el.hasAttribute('aria-disabled')).toBe(false);
};

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.calls = [];
  state.status = new Map();
  state.gates = new Map();
  state.hang = new Set();
  state.sf = SF({ bankAccountNo: '1234567890', bankName: 'VCB' });
  state.picker = [PRODUCT('p2', 'Xà phòng'), PRODUCT('p3', 'Dầu gội')];
  state.categories = [{ id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null }, { id: 'cat2', name: 'Nhà bếp', slug: 'nha-bep', image: null }];
  uncapped = false;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const mountUi = async (ui: ReactElement) => {
  mounted = render(<Host>{ui}</Host>, qc);
  await flush();
};

interface Cmd {
  name: string;
  /** Giao diện đang mở của tấm (mỗi lần gọi dựng phần tử mới, dùng cho cả dựng lại). */
  ui: () => ReactElement;
  press: () => HTMLElement;
  /** Lệnh đầu tiên mà cú chạm gửi đi (đếm chạm đúp). */
  first: string;
  /** Lệnh bị cho lỗi trong ca bị từ chối. */
  fail: string;
  /** Các lần tải phải được làm mới khi máy chủ từ chối. */
  reloads: string[];
  /** Lệnh dựng từ ô của gian hàng: gian hàng mới chưa về thì hàng rào độ mới giữ nút bận dù khoá đã nhả sau 4 giây (storefront-sheets-fresh-barrier.spec). */
  readsStorefront?: boolean;
}

const COMMANDS: Cmd[] = [
  {
    name: 'Chọn mẫu (tạo gian hàng rồi áp mẫu)',
    ui: () => <TemplateSheet open onClose={noop} onCreated={refresh} />,
    press: () => btn('Dùng mẫu Nhà bếp'),
    first: 'post /storefront',
    fail: 'post /storefront/me/apply-template',
    reloads: [ME, QUESTS, CATEGORIES],
  },
  {
    name: 'Bỏ qua, tạo gian hàng trống',
    ui: () => <TemplateSheet open onClose={noop} onCreated={refresh} />,
    press: () => btn('Bỏ qua, tự tạo gian hàng trống', 'Đang tạo…'),
    first: 'post /storefront',
    fail: 'post /storefront',
    reloads: [ME, QUESTS],
  },
  {
    name: 'Thêm sản phẩm vào khối',
    ui: () => <PickerSheet open collectionId="c1" onClose={noop} onAdded={refresh} />,
    press: () => btn('Thêm Xà phòng'),
    first: 'post /storefront/me/collections/c1/items',
    fail: 'post /storefront/me/collections/c1/items',
    reloads: [ME, QUESTS, PICKER],
  },
  {
    name: 'Lưu hồ sơ',
    ui: () => <ProfileSheet open sf={asSf()} onClose={noop} onSaved={refresh} />,
    press: () => btn('Lưu hồ sơ', 'Đang lưu…', 'Đang cập nhật…'),
    first: PATCH_ME,
    fail: PATCH_ME,
    reloads: [ME, QUESTS],
    readsStorefront: true,
  },
  {
    name: 'Lưu cấu hình',
    ui: () => <ConfigSheet open sf={asSf()} onClose={noop} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />,
    press: () => btn('Lưu cấu hình gian hàng', 'Đang lưu…', 'Đang cập nhật…'),
    first: PATCH_ME,
    fail: PATCH_ME,
    reloads: [ME, QUESTS],
    readsStorefront: true,
  },
  {
    name: 'Gỡ tài khoản ngân hàng',
    ui: () => <ConfigSheet open sf={asSf({ bankAccountNo: '1234567890', bankName: 'VCB' })} onClose={noop} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />,
    press: () => btn('Gỡ tài khoản đã lưu'),
    first: PATCH_ME,
    fail: PATCH_ME,
    reloads: [ME, QUESTS],
  },
  {
    name: 'Đổi tên khối',
    ui: () => <CollectionSheet collection={COLLECTION} onClose={noop} onSaved={refresh} />,
    press: () => btn('Lưu', 'Đang lưu…', 'Đang cập nhật…'),
    first: 'patch /storefront/me/collections/c1',
    fail: 'patch /storefront/me/collections/c1',
    reloads: [ME, QUESTS],
    readsStorefront: true,
  },
];

describe.each(COMMANDS)('$name', (cmd) => {
  const mountCmd = () => mountUi(cmd.ui());
  const counts = () => Object.fromEntries(cmd.reloads.map((k) => [k, gets(k)]));

  it('hai cú chạm cùng khung hình chỉ gửi một lần; nút báo bận bằng aria, không disabled', async () => {
    await mountCmd();
    const release = hold(cmd.first);
    const press = cmd.press();
    await tap(press, 2);
    expect(writes(cmd.first)).toBe(1);
    expectBusy(cmd.press());
    await release();
  });

  it('dựng lại tấm lúc lệnh còn bay (cùng QueryClient): nút còn bận, cú chạm lần hai không gửi lại', async () => {
    await mountCmd();
    const release = hold(cmd.first);
    await tap(cmd.press());
    expect(writes(cmd.first)).toBe(1);
    remount(mounted!, <Host>{cmd.ui()}</Host>, qc);
    await flush();
    expect(cmd.press().getAttribute('aria-disabled')).toBe('true');
    expect((cmd.press() as HTMLButtonElement).disabled).toBe(false);
    await tap(cmd.press(), 2);
    expect(writes(cmd.first)).toBe(1);
    await release();
    expectIdle(cmd.press());
    await tap(cmd.press());
    expect(writes(cmd.first)).toBe(2);
  });

  it('thành công: khoá giữ tới khi dữ liệu mới về, rồi nhả', async () => {
    await mountCmd();
    const releaseFresh = hold(ME);
    await tap(cmd.press());
    expect(writes(cmd.first)).toBe(1);
    expectBusy(cmd.press());
    await tap(cmd.press(), 2);
    expect(writes(cmd.first)).toBe(1);
    await releaseFresh();
    expectIdle(cmd.press());
    await tap(cmd.press());
    expect(writes(cmd.first)).toBe(2);
  });

  it.each([400, 404, 409, 422])('bị máy chủ từ chối (%i): lời lỗi hiện ngay, tải lại đúng các khoá, khoá giữ tới khi dữ liệu mới về', async (status) => {
    await mountCmd();
    const before = counts();
    state.status.set(cmd.fail, status);
    const releaseFresh = hold(ME);
    await tap(cmd.press());
    expect(alerts()).toContain(`Lời máy chủ ${status}`);
    for (const key of cmd.reloads) expect(gets(key), key).toBe(before[key]! + 1);
    expect(writes(cmd.first)).toBe(1);
    expectBusy(cmd.press());
    await tap(cmd.press(), 2);
    expect(writes(cmd.first)).toBe(1);
    await releaseFresh();
    expectIdle(cmd.press());
    expect(alerts()).toContain(`Lời máy chủ ${status}`);
    state.status.delete(cmd.fail);
    await tap(cmd.press());
    expect(writes(cmd.first)).toBe(2);
  });

  it.each([500, 503, 401, 403, 0])('lỗi tạm hoặc không phải lời từ chối (%i): không tải lại, khoá nhả ngay, lời lỗi hiện', async (status) => {
    await mountCmd();
    const before = counts();
    state.status.set(cmd.fail, status);
    await tap(cmd.press());
    expect(alerts()).toContain(status === 0 ? 'Mất kết nối giả' : `Lời máy chủ ${status}`);
    for (const key of cmd.reloads) expect(gets(key), key).toBe(before[key]!);
    expectIdle(cmd.press());
    state.status.delete(cmd.fail);
    await tap(cmd.press());
    expect(writes(cmd.first)).toBe(2);
  });

  describe('dữ liệu mới không bao giờ về', () => {
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    });
    // Sau 4 giây khoá chạm đúp nhả. Lệnh dựng từ ô của gian hàng còn bị hàng rào độ mới giữ ("Đang cập nhật…", không còn "Đang lưu…") tới khi một lần đọc gian hàng thành công.
    const lockReleasedAfterCap = async () => {
      if (cmd.readsStorefront) {
        expectBusy(cmd.press());
        expect(cmd.press().textContent).toBe('Đang cập nhật…');
        state.hang.delete(ME);
        await act(async () => {
          await qc.refetchQueries({ queryKey: ['my-storefront'] });
        });
        await flush(2);
      } else {
        state.hang.delete(ME);
      }
      expectIdle(cmd.press());
    };

    it('thành công: nhả khoá sau 4 giây dù lời gọi báo xong của chỗ gọi không có hạn', async () => {
      uncapped = true;
      await mountCmd();
      state.hang.add(ME);
      await tap(cmd.press());
      expect(writes(cmd.first)).toBe(1);
      await advance(3_000);
      expectBusy(cmd.press());
      await advance(1_500);
      await flush(2);
      await lockReleasedAfterCap();
      await tap(cmd.press());
      expect(writes(cmd.first)).toBe(2);
    });

    it('bị từ chối: nhả khoá sau 4 giây', async () => {
      await mountCmd();
      state.status.set(cmd.fail, 404);
      state.hang.add(ME);
      await tap(cmd.press());
      expect(writes(cmd.first)).toBe(1);
      await advance(3_000);
      expectBusy(cmd.press());
      await advance(1_500);
      await flush(2);
      state.status.delete(cmd.fail);
      await lockReleasedAfterCap();
      await tap(cmd.press());
      expect(writes(cmd.first)).toBe(2);
    });
  });
});

describe('Lưu cấu hình: ô nhập khớp DTO và lỗi nhập không tải lại', () => {
  const ui = (over: Record<string, unknown> = {}) => <ConfigSheet open sf={asSf(over)} onClose={noop} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />;
  const save = () => btn('Lưu cấu hình gian hàng', 'Đang lưu…');
  const titleInput = () => document.body.querySelector<HTMLInputElement>('input:not([aria-label])')!;

  it('ô tên, subdomain, kho, thành phố, hotline có maxLength bằng DTO (120, 30, 200, 200, 200)', async () => {
    await mountUi(ui({ subdomainEnabled: true, type: 'MERCHANT' }));
    expect(titleInput().maxLength).toBe(120);
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="vd: brand1"]')!.maxLength).toBe(30);
    expect(inputByLabel('Địa chỉ kho xuất hàng')!.maxLength).toBe(200);
    expect(inputByLabel('Tỉnh / Thành phố')!.maxLength).toBe(200);
    expect(inputByLabel('Hotline kho liên hệ')!.maxLength).toBe(200);
  });

  it('lời gửi giữ nguyên: tên, màu; subdomain chỉ gửi khi đã đổi', async () => {
    await mountUi(ui({ subdomainEnabled: true, subdomain: 'cu' }));
    await tap(save());
    expect(state.calls.find((c) => c.method === 'patch')!.body).toEqual({ title: 'Cửa hàng Xanh', themeColor: '#16a34a' });
    typeInto(document.body.querySelector('input[placeholder="vd: brand1"]'), 'brand1');
    await tap(save());
    expect(state.calls.filter((c) => c.method === 'patch')[1]!.body).toEqual({ title: 'Cửa hàng Xanh', subdomain: 'brand1', themeColor: '#16a34a' });
  });

  it('tên để trống thì không gửi tên (giữ tên cũ)', async () => {
    await mountUi(ui());
    typeInto(titleInput(), '   ');
    await tap(save());
    expect((state.calls.find((c) => c.method === 'patch')!.body as { title?: string }).title).toBeUndefined();
  });

  it('400 của lệnh có gửi subdomain là lỗi nhập: hiện lời máy chủ, KHÔNG tải lại, khoá nhả ngay, chữ khách gõ còn nguyên', async () => {
    await mountUi(ui({ subdomainEnabled: true }));
    typeInto(titleInput(), 'Tên mới của tôi');
    typeInto(document.body.querySelector('input[placeholder="vd: brand1"]'), 'brand1');
    const before = { me: gets(ME), quests: gets(QUESTS) };
    state.status.set(PATCH_ME, 400);
    await tap(save());
    expect(alerts()).toContain('Lời máy chủ 400');
    expect(gets(ME)).toBe(before.me);
    expect(gets(QUESTS)).toBe(before.quests);
    expectIdle(save());
    expect(titleInput().value).toBe('Tên mới của tôi');
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="vd: brand1"]')!.value).toBe('brand1');
    state.status.delete(PATCH_ME);
    typeInto(document.body.querySelector('input[placeholder="vd: brand1"]'), 'brand2');
    await tap(save());
    expect(writes(PATCH_ME)).toBe(2);
    expect(state.calls.filter((c) => c.method === 'patch')[1]!.body).toMatchObject({ subdomain: 'brand2' });
    expect(alerts()).toEqual([]);
  });

  it('400 của lệnh KHÔNG gửi subdomain là trạng thái cũ: tải lại, nhưng tên khách đang gõ không bị dữ liệu mới ghi đè', async () => {
    await mountUi(<LiveSf>{(sf) => <ConfigSheet open sf={sf} onClose={noop} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />}</LiveSf>);
    typeInto(titleInput(), 'Tên tôi gõ dở');
    state.sf = SF({ title: 'Tên từ máy chủ mới' });
    state.status.set(PATCH_ME, 400);
    const before = gets(ME);
    await tap(save());
    expect(gets(ME)).toBe(before + 1);
    expect(cachedSf()!.title).toBe('Tên từ máy chủ mới');
    expect(titleInput().value).toBe('Tên tôi gõ dở');
    expect(alerts()).toContain('Lời máy chủ 400');
  });

  it('bị từ chối rồi gian hàng mới về từ máy khác: ô khách chưa đụng theo bản mới, ô đã gõ giữ nguyên, lần lưu kế gửi đúng cả hai', async () => {
    const [, teal, blue] = STOREFRONT_THEME_COLORS;
    await mountUi(<LiveSf>{(sf) => <ConfigSheet open sf={sf} onClose={noop} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />}</LiveSf>);
    typeInto(titleInput(), 'Tên tôi gõ');
    state.sf = SF({ title: 'Tên máy khác', themeColor: teal.code });
    state.status.set(PATCH_ME, 409);
    await tap(save());
    expect(cachedSf()!.themeColor).toBe(teal.code);
    expect(titleInput().value).toBe('Tên tôi gõ');
    expect(document.body.querySelector(`[aria-label="${teal.label}"]`)!.getAttribute('aria-pressed')).toBe('true');
    state.status.delete(PATCH_ME);
    await tap(save());
    expect(state.calls.filter((c) => c.method === 'patch')[1]!.body).toEqual({ title: 'Tên tôi gõ', themeColor: teal.code });
    // Khách chọn màu rồi thì màu đó là của khách, dù gian hàng mới về sau.
    await tap(document.body.querySelector<HTMLElement>(`[aria-label="${blue.label}"]`)!);
    state.sf = SF({ themeColor: STOREFRONT_THEME_COLORS[4].code });
    await act(async () => void qc.invalidateQueries({ queryKey: myStorefrontQuery(coreHttp).queryKey }));
    await flush();
    expect(document.body.querySelector(`[aria-label="${blue.label}"]`)!.getAttribute('aria-pressed')).toBe('true');
    expect(titleInput().value).toBe('Tên tôi gõ');
  });

  it('404 của lệnh có gửi subdomain (gian hàng không còn) vẫn là trạng thái cũ: tải lại', async () => {
    await mountUi(ui({ subdomainEnabled: true }));
    typeInto(document.body.querySelector('input[placeholder="vd: brand1"]'), 'brand1');
    state.status.set(PATCH_ME, 404);
    const before = gets(ME);
    await tap(save());
    expect(gets(ME)).toBe(before + 1);
  });

  it('chữ subdomain đã gửi nhưng không đổi so với đang lưu thì 400 là trạng thái (lệnh không mang subdomain)', async () => {
    await mountUi(ui({ subdomainEnabled: true, subdomain: 'cu' }));
    state.status.set(PATCH_ME, 400);
    const before = gets(ME);
    await tap(save());
    expect((state.calls.find((c) => c.method === 'patch')!.body as { subdomain?: string }).subdomain).toBeUndefined();
    expect(gets(ME)).toBe(before + 1);
  });
});

describe('Hồ sơ gian hàng: ô lời nhắn khớp DTO', () => {
  it('lời nhắn có maxLength 200 như HeaderNote của DTO; gửi chuỗi đã cắt khoảng trắng', async () => {
    await mountUi(<ProfileSheet open sf={asSf()} onClose={noop} onSaved={refresh} />);
    const note = document.body.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(note.maxLength).toBe(200);
    typeInto(note, '  Xin chào  ');
    await tap(btn('Lưu hồ sơ'));
    expect(state.calls.find((c) => c.method === 'patch')!.body).toEqual({ avatarUrl: '', coverUrl: '', headerNote: 'Xin chào' });
  });
});

describe('Thêm sản phẩm (PickerSheet)', () => {
  const ui = () => <PickerSheet open collectionId="c1" onClose={noop} onAdded={refresh} />;
  const ADD = 'post /storefront/me/collections/c1/items';

  it('chỉ nút của món đang thêm báo aria-busy, kể cả sau khi tấm dựng lại; món khác chỉ aria-disabled', async () => {
    await mountUi(ui());
    const release = hold(ADD);
    await tap(btn('Thêm Xà phòng'));
    remount(mounted!, <Host>{ui()}</Host>, qc);
    await flush();
    expectBusy(btn('Thêm Xà phòng'));
    expect(btn('Thêm Dầu gội').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Thêm Dầu gội').hasAttribute('aria-busy')).toBe(false);
    await tap(btn('Thêm Dầu gội'));
    expect(writes(ADD)).toBe(1);
    await release();
  });

  it('chạm món thứ hai: chỉ nút của món đó báo bận, món thứ nhất chỉ aria-disabled', async () => {
    await mountUi(ui());
    const release = hold(ADD);
    await tap(btn('Thêm Dầu gội'));
    expectBusy(btn('Thêm Dầu gội'));
    expect(btn('Thêm Xà phòng').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Thêm Xà phòng').hasAttribute('aria-busy')).toBe(false);
    expect(state.calls.find((c) => c.path === '/storefront/me/collections/c1/items')!.body).toEqual({ productId: 'p3' });
    await release();
  });

  it('nút "Xong" không đóng tấm khi đang thêm, kể cả sau khi tấm dựng lại', async () => {
    const onClose = vi.fn();
    await mountUi(<PickerSheet open collectionId="c1" onClose={onClose} onAdded={refresh} />);
    const release = hold(ADD);
    await tap(btn('Thêm Xà phòng'));
    remount(mounted!, <Host><PickerSheet open collectionId="c1" onClose={onClose} onAdded={refresh} /></Host>, qc);
    await flush();
    await tap(btn('Xong'));
    expect(onClose).not.toHaveBeenCalled();
    await release();
    await tap(btn('Xong'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bị từ chối mà danh sách tải lại lỗi: danh sách cũ còn nguyên, lời lỗi của lệnh còn, không thay bằng màn lỗi', async () => {
    await mountUi(ui());
    state.status.set(ADD, 400);
    state.status.set(PICKER, 500);
    await tap(btn('Thêm Xà phòng'));
    expect(btn('Thêm Xà phòng')).toBeTruthy();
    expect(alerts()).toEqual(['Lời máy chủ 400']);
    expect(document.body.textContent).not.toContain('Thử lại');
  });

  it('tải lại danh sách theo đúng ô tìm kiếm đang gõ', async () => {
    await mountUi(ui());
    typeInto(inputByLabel('Tìm sản phẩm'), 'xà');
    await flush();
    state.status.set(ADD, 404);
    const before = state.calls.filter((c) => `${c.method} ${c.path}` === PICKER && (c.query as { search?: string })?.search === 'xà').length;
    await tap(btn('Thêm Xà phòng'));
    const after = state.calls.filter((c) => `${c.method} ${c.path}` === PICKER && (c.query as { search?: string })?.search === 'xà').length;
    expect(after).toBe(before + 1);
  });

  it('gửi đúng productId, khoá một sản phẩm mỗi lúc', async () => {
    await mountUi(ui());
    await tap(btn('Thêm Xà phòng'));
    expect(state.calls.find((c) => c.path === '/storefront/me/collections/c1/items')!.body).toEqual({ productId: 'p2' });
  });
});

describe('Chọn mẫu (TemplateSheet)', () => {
  const ui = () => <TemplateSheet open onClose={noop} onCreated={refresh} />;

  it('chạm mẫu rồi chạm "Bỏ qua" trong CÙNG khung hình chỉ tạo một gian hàng (hai nút là hai lệnh khác nhau, chỉ cờ chung chặn được)', async () => {
    await mountUi(ui());
    const template = btn('Dùng mẫu Nhà bếp');
    const blank = btn('Bỏ qua, tự tạo gian hàng trống');
    const release = hold('post /storefront');
    act(() => {
      template.click();
      blank.click();
    });
    await flush();
    expect(writes('post /storefront')).toBe(1);
    await release();
  });

  it('mẫu đang tạo đổi chữ thành "đang tạo", mẫu khác giữ tên', async () => {
    await mountUi(ui());
    const release = hold('post /storefront');
    await tap(btn('Dùng mẫu Nhà bếp'));
    expect(btn('Dùng mẫu Nhà bếp').textContent).toBe(STOREFRONT_TEMPLATE_BUSY);
    expect(btn('Dùng mẫu Chăm sóc da').textContent).toBe('Chăm sóc da');
    await release();
  });

  it('bị từ chối mà danh mục tải lại lỗi: danh mục cũ còn nguyên, không thay bằng màn lỗi', async () => {
    await mountUi(ui());
    state.status.set('post /storefront/me/apply-template', 400);
    state.status.set(CATEGORIES, 500);
    await tap(btn('Dùng mẫu Nhà bếp'));
    expect(btn('Dùng mẫu Chăm sóc da')).toBeTruthy();
    expect(alerts()).toEqual(['Lời máy chủ 400']);
    expect(document.body.textContent).not.toContain('Thử lại');
  });

  it('sau khi dựng lại lúc đang tạo: chỉ nút của mẫu đang tạo báo bận, nút "Bỏ qua" và mẫu khác chỉ aria-disabled', async () => {
    await mountUi(ui());
    const release = hold('post /storefront');
    await tap(btn('Dùng mẫu Nhà bếp'));
    remount(mounted!, <Host>{ui()}</Host>, qc);
    await flush();
    expectBusy(btn('Dùng mẫu Nhà bếp'));
    expect(btn('Dùng mẫu Chăm sóc da').getAttribute('aria-disabled')).toBe('true');
    expect(btn('Dùng mẫu Chăm sóc da').hasAttribute('aria-busy')).toBe(false);
    expect(btn('Bỏ qua, tự tạo gian hàng trống').getAttribute('aria-disabled')).toBe('true');
    await tap(btn('Bỏ qua, tự tạo gian hàng trống'));
    expect(writes('post /storefront')).toBe(1);
    await release();
  });

  it('"Bỏ qua" lúc mẫu đang tạo cũng bị chặn sau khi dựng lại', async () => {
    await mountUi(ui());
    const release = hold('post /storefront');
    await tap(btn('Bỏ qua, tự tạo gian hàng trống'));
    remount(mounted!, <Host>{ui()}</Host>, qc);
    await flush();
    await tap(btn('Dùng mẫu Nhà bếp'));
    expect(writes('post /storefront')).toBe(1);
    await release();
  });
});

describe('Đổi tên khối: 403 của API khi khối không còn (assertOwnedCollection)', () => {
  it('403 không tải lại (không phân biệt được với mất quyền thật) và khoá nhả ngay để thử lại', async () => {
    await mountUi(<CollectionSheet collection={COLLECTION} onClose={noop} onSaved={refresh} />);
    state.status.set('patch /storefront/me/collections/c1', 403);
    const before = gets(ME);
    await tap(btn('Lưu'));
    expect(gets(ME)).toBe(before);
    expect(alerts()).toEqual(['Lời máy chủ 403']);
    expectIdle(btn('Lưu'));
  });

  // Chỉ pha lệnh còn bay còn thấy được khoá riêng của từng khối: sau khi lệnh xong, gian hàng được làm mới và hàng rào độ mới giữ mọi form dựng từ gian hàng
  // (kể cả khối khác) tới khi bản mới về, cùng lúc khoá của khối A nhả (storefront-sheets-fresh-barrier.spec).
  it('khoá theo khối: khối A còn đang gửi thì khối B đổi tên được, A thì vẫn bị chặn', async () => {
    const other = { ...COLLECTION, id: 'c2', title: 'Bộ sưu tập B' } as StorefrontCollectionEdit;
    await mountUi(<CollectionSheet collection={COLLECTION} onClose={noop} onSaved={refresh} />);
    const releaseWrite = hold('patch /storefront/me/collections/c1');
    await tap(btn('Lưu', 'Đang lưu…'));
    expect(writes('patch /storefront/me/collections/c1')).toBe(1);
    remount(mounted!, <Host><CollectionSheet collection={other} onClose={noop} onSaved={refresh} /></Host>, qc);
    await flush();
    expectIdle(btn('Lưu'));
    await tap(btn('Lưu'));
    expect(writes('patch /storefront/me/collections/c2')).toBe(1);
    remount(mounted!, <Host><CollectionSheet collection={COLLECTION} onClose={noop} onSaved={refresh} /></Host>, qc);
    await flush();
    expectBusy(btn('Lưu', 'Đang lưu…'));
    await tap(btn('Lưu', 'Đang lưu…'));
    expect(writes('patch /storefront/me/collections/c1')).toBe(1);
    await releaseWrite();
  });

  it('khối A còn chờ dữ liệu mới: tấm của khối B vẫn đóng được bằng chạm nền, tấm của A thì bị chặn', async () => {
    const other = { ...COLLECTION, id: 'c2', title: 'Bộ sưu tập B' } as StorefrontCollectionEdit;
    const onClose = vi.fn();
    const backdrop = () => document.body.querySelector<HTMLElement>('[data-sheet-backdrop]')!;
    await mountUi(<CollectionSheet collection={COLLECTION} onClose={onClose} onSaved={refresh} />);
    const releaseFresh = hold(ME);
    await tap(btn('Lưu', 'Đang lưu…'));
    // Lưu xong thì chính lệnh gọi `onClose` một lần; chạm nền lúc A còn chờ dữ liệu mới không đóng thêm.
    expect(onClose).toHaveBeenCalledTimes(1);
    await tap(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
    remount(mounted!, <Host><CollectionSheet collection={other} onClose={onClose} onSaved={refresh} /></Host>, qc);
    await flush();
    await tap(backdrop());
    expect(onClose).toHaveBeenCalledTimes(2);
    await releaseFresh();
  });

  it('gửi tên đã cắt khoảng trắng; ô tên có maxLength 80 như DTO', async () => {
    await mountUi(<CollectionSheet collection={COLLECTION} onClose={noop} onSaved={refresh} />);
    const input = document.body.querySelector<HTMLInputElement>('input')!;
    expect(input.maxLength).toBe(80);
    typeInto(input, '  Tên mới  ');
    await tap(btn('Lưu'));
    expect(state.calls.find((c) => c.method === 'patch')!.body).toEqual({ title: 'Tên mới' });
  });
});

describe('Gỡ tài khoản ngân hàng: gửi bốn trường rỗng, giữ khoá tới khi nút biến mất cùng dữ liệu mới', () => {
  it('lời gửi giữ nguyên', async () => {
    await mountUi(<ConfigSheet open sf={asSf({ bankAccountNo: '1234567890', bankName: 'VCB' })} onClose={noop} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />);
    await tap(btn('Gỡ tài khoản đã lưu'));
    expect(state.calls.find((c) => c.method === 'patch')!.body).toEqual({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });
  });
});

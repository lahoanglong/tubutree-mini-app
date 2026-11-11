// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { QueryClient, onlineManager, useQuery } from '@tanstack/react-query';
import { flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Wave 101B: Lưu của hồ sơ, cấu hình và đổi tên khối không được gửi giá trị cũ đè bản mới trên máy chủ.
// Khoá chạm đúp nhả sau tối đa 4 giây dù gian hàng mới chưa về; lúc đó ô chưa chạm còn giá trị cũ. Hàng rào độ mới đọc cờ `isInvalidated` của
// gian hàng trong bộ nhớ đệm: còn dựng thì Lưu không gửi gì, tới khi một lần đọc thành công xoá cờ.

type Call = { method: string; path: string; body?: unknown };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  status: new Map<string, number>(),
  gates: new Map<string, Promise<void>>(),
  sf: null as Record<string, unknown> | null,
}));

function httpError(status: number) {
  return Object.assign(new Error(`Lời máy chủ ${status}`), { status });
}

vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown) => {
    state.calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const gate = state.gates.get(key);
    if (gate) await gate;
    const status = state.status.get(key);
    if (status !== undefined) throw httpError(status);
    if (method === 'get') {
      if (path === '/storefront/me') return state.sf;
      if (path === '/storefront/me/quests') return { quests: [], totalEarnedPoints: 0, level: 1, levelMax: 5 };
    }
    return { id: 'x', ok: true };
  };
  return {
    coreHttp: {
      get: (p: string) => run('get', p),
      post: (p: string, b?: unknown) => run('post', p, b),
      patch: (p: string, b?: unknown) => run('patch', p, b),
      delete: (p: string) => run('delete', p),
      put: (p: string, b?: unknown) => run('put', p, b),
    },
  };
});

import { myStorefrontQuery, storefrontQuestsQuery } from '@tubutree/app-core/queries/storefront';
import type { StorefrontCollectionEdit, StorefrontEdit } from '@tubutree/app-core/api/storefront';
import { coreHttp } from '@/lib/core-http';
import { settleWithin } from '@/lib/settle-within';
import { CollectionSheet, ConfigSheet, ProfileSheet } from './storefront-sheets';
import { STOREFRONT_THEME_COLORS } from './storefront-theme';

const TEAL = STOREFRONT_THEME_COLORS[1].code;
const A1 = 'https://cdn.example/a1.png';
const A2 = 'https://cdn.example/a2.png';
const STALE_NOTICE = 'Chưa tải được dữ liệu gian hàng mới nhất, bấm Lưu lại sau khi tải xong.';
const OFFLINE_NOTICE = 'Mất kết nối. Có mạng lại thì bấm Lưu.';
const GONE_NOTICE = 'Gian hàng không còn truy cập được, tải lại trang.';

const SF = (over: Record<string, unknown>) => ({
  id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: 'Mua giúp mình nhé', avatarUrl: A1, coverUrl: null, theme: 'default', themeColor: null,
  subdomain: null, subdomainEnabled: false, isPublished: false, collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] }], ...over,
});
const BEFORE = SF({});
const AFTER = SF({
  title: 'Tên mới', headerNote: 'Lời mới', avatarUrl: A2, themeColor: TEAL,
  collections: [{ id: 'c1', title: 'Khối mới', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] }],
});

let qc: QueryClient;
let mounted: Rendered | null = null;

const ME = 'get /storefront/me';

/** Giống trình dựng: tải lại gian hàng, trả Promise có hạn 4 giây. */
const refresh = () => settleWithin(qc.invalidateQueries({ queryKey: ['my-storefront'] }));

interface FormCase {
  name: string;
  /** Ô chữ chính của form (khách gõ vào đây). */
  field: () => HTMLInputElement | HTMLTextAreaElement;
  fieldOf: (sf: Record<string, unknown>) => string;
  typedFirst: string;
  labels: string[];
  patch: string;
  ui: (sf: StorefrontEdit, open: boolean, close: () => void) => ReactElement;
  body: (text: string, server: Record<string, unknown>) => unknown;
}

const noop = () => {};
const input = (sel: string) => document.body.querySelector<HTMLInputElement>(sel)!;

const FORMS: FormCase[] = [
  {
    name: 'Hồ sơ gian hàng',
    field: () => document.body.querySelector<HTMLTextAreaElement>('textarea')!,
    fieldOf: (s) => s.headerNote as string,
    typedFirst: 'Lời mới',
    labels: ['Lưu hồ sơ', 'Đang lưu…', 'Đang cập nhật…'],
    patch: 'patch /storefront/me',
    ui: (sf, open, close) => <ProfileSheet open={open} sf={sf} onClose={close} onSaved={refresh} />,
    body: (text, s) => ({ avatarUrl: s.avatarUrl ?? '', coverUrl: s.coverUrl ?? '', headerNote: text }),
  },
  {
    name: 'Cấu hình gian hàng',
    field: () => input('input:not([aria-label])'),
    fieldOf: (s) => s.title as string,
    typedFirst: 'Tên mới',
    labels: ['Lưu cấu hình gian hàng', 'Đang lưu…', 'Đang cập nhật…'],
    patch: 'patch /storefront/me',
    ui: (sf, open, close) => <ConfigSheet open={open} sf={sf} onClose={close} onSaved={refresh} unpublishLabel={null} onUnpublish={noop} />,
    body: (text, s) => ({ title: text, themeColor: s.themeColor ?? '#16a34a' }),
  },
  {
    name: 'Đổi tên khối',
    field: () => input('input'),
    fieldOf: (s) => (s.collections as { title: string }[])[0]!.title,
    typedFirst: 'Khối mới',
    labels: ['Lưu', 'Đang lưu…', 'Đang cập nhật…'],
    patch: 'patch /storefront/me/collections/c1',
    ui: (sf, open, close) => <CollectionSheet collection={open ? ((sf.collections as StorefrontCollectionEdit[])[0] ?? null) : null} onClose={close} onSaved={refresh} />,
    body: (text) => ({ title: text }),
  },
];

/** Như trang cha: `sf` lấy từ bộ nhớ đệm; nút "mở lại" mở lại đúng tấm sau khi lưu xong đã tự đóng. */
function Stage({ form }: { form: FormCase }) {
  const q = useQuery(myStorefrontQuery(coreHttp));
  useQuery(storefrontQuestsQuery(coreHttp));
  const [open, setOpen] = useState(true);
  if (!q.data) return null;
  return (
    <>
      <button type="button" data-reopen onClick={() => setOpen(true)}>
        mở lại
      </button>
      {form.ui(q.data as unknown as StorefrontEdit, open, () => setOpen(false))}
    </>
  );
}

function save(form: FormCase): HTMLElement {
  const dialog = document.body.querySelector('[role="dialog"]');
  const hit = Array.from(dialog?.querySelectorAll<HTMLElement>('button') ?? []).find((e) => form.labels.includes((e.textContent ?? '').trim()));
  if (!hit) throw new Error(`không thấy nút Lưu của ${form.name}`);
  return hit;
}
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? '');
const writes = (key: string) => state.calls.filter((c) => `${c.method} ${c.path}` === key).length;
const patchBodies = (key: string) => state.calls.filter((c) => `${c.method} ${c.path}` === key).map((c) => c.body);
const tap = async (el: HTMLElement) => {
  act(() => el.click());
  await flush();
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const hold = (key: string) => {
  let release!: () => void;
  state.gates.set(key, new Promise<void>((r) => { release = r; }));
  return async () => {
    state.gates.delete(key);
    await act(async () => release());
    await flush();
  };
};
const expectBarrier = (el: HTMLElement) => {
  expect(el.getAttribute('aria-busy')).toBe('true');
  expect(el.getAttribute('aria-disabled')).toBe('true');
  expect((el as HTMLButtonElement).disabled).toBe(false);
  expect(el.textContent).toBe('Đang cập nhật…');
};
const expectIdle = (el: HTMLElement) => {
  expect(el.hasAttribute('aria-busy')).toBe(false);
  expect(el.hasAttribute('aria-disabled')).toBe(false);
};
const reopen = () => tap(document.body.querySelector<HTMLElement>('[data-reopen]')!);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.calls = [];
  state.status = new Map();
  state.gates = new Map();
  state.sf = BEFORE;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

const mountStage = async (form: FormCase) => {
  mounted = render(<Stage form={form} />, qc);
  await flush();
};

/** Lưu thành công lần đầu; gian hàng mới treo quá 4 giây nên khoá nhả khi form mở lại vẫn mang giá trị cũ. */
async function savedWhileFreshHangs(form: FormCase) {
  await mountStage(form);
  const releaseFresh = hold(ME);
  typeInto(form.field(), form.typedFirst);
  await tap(save(form));
  expect(writes(form.patch)).toBe(1);
  state.sf = AFTER;
  await advance(4_500);
  await flush(2);
  await reopen();
  return releaseFresh;
}

describe.each(FORMS)('$name', (form) => {
  it('gian hàng mới chưa về sau 4 giây: Lưu không gửi gì, nút báo bận bằng aria; bản mới về thì ô chưa chạm đổi theo và Lưu gửi giá trị MỚI', async () => {
    const releaseFresh = await savedWhileFreshHangs(form);
    expect(form.field().value).toBe(form.fieldOf(BEFORE));
    expectBarrier(save(form));
    await tap(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expectBarrier(save(form));
    await releaseFresh();
    expect(form.field().value).toBe(form.fieldOf(AFTER));
    expectIdle(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(2);
    expect(patchBodies(form.patch)[1]).toEqual(form.body(form.fieldOf(AFTER), AFTER));
  });

  it('ô khách đã gõ là của khách: bản mới về không ghi đè chữ, các ô chưa chạm theo bản mới', async () => {
    const releaseFresh = await savedWhileFreshHangs(form);
    typeInto(form.field(), 'Khách gõ');
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    await releaseFresh();
    expect(form.field().value).toBe('Khách gõ');
    await tap(save(form));
    expect(writes(form.patch)).toBe(2);
    expect(patchBodies(form.patch)[1]).toEqual(form.body('Khách gõ', AFTER));
  });

  it('lần đọc mới đã lỗi: chạm Lưu gọi lại lần đọc, không gửi lệnh ghi, hiện lời tại chỗ; đọc lại được thì lời mất và Lưu gửi giá trị mới', async () => {
    await mountStage(form);
    state.status.set(ME, 500);
    typeInto(form.field(), form.typedFirst);
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    state.sf = AFTER;
    await flush(2);
    await reopen();
    expect(alerts()).toEqual([]);
    const reads = writes(ME);
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expect(writes(ME)).toBe(reads + 1);
    expect(alerts()).toEqual([STALE_NOTICE]);
    expect(save(form).getAttribute('aria-disabled')).toBe('true');
    expect(form.field().value).toBe(form.fieldOf(BEFORE));
    state.status.delete(ME);
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expect(writes(ME)).toBe(reads + 2);
    expect(alerts()).toEqual([]);
    expect(form.field().value).toBe(form.fieldOf(AFTER));
    expectIdle(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(2);
    expect(patchBodies(form.patch)[1]).toEqual(form.body(form.fieldOf(AFTER), AFTER));
  });

  it('lần đọc lại vẫn lỗi: Lưu vẫn không gửi, lời tại chỗ còn, không có lệnh đọc nào treo', async () => {
    await mountStage(form);
    state.status.set(ME, 500);
    await tap(save(form));
    await flush(2);
    await reopen();
    await tap(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expect(alerts()).toEqual([STALE_NOTICE]);
    expect(save(form).hasAttribute('aria-busy')).toBe(false);
  });

  // Mất mạng làm lần đọc lại ở trạng thái `paused` chứ không `fetching`: coi như đang đọc thì nút báo "Đang cập nhật…" mãi và chạm không nói gì.
  it('mất mạng lúc lần đọc lại: nút không kẹt "Đang cập nhật…", chạm báo mất kết nối tại chỗ và không gửi lệnh ghi; có mạng lại thì đọc xong và Lưu gửi bản mới', async () => {
    await mountStage(form);
    onlineManager.setOnline(false);
    state.sf = AFTER;
    act(() => {
      void qc.invalidateQueries({ queryKey: ['my-storefront'] });
    });
    await flush(2);
    expect(qc.getQueryState(['my-storefront'])?.fetchStatus).toBe('paused');
    expect(save(form).hasAttribute('aria-busy')).toBe(false);
    expect(save(form).textContent).not.toBe('Đang cập nhật…');
    expect(save(form).getAttribute('aria-disabled')).toBe('true');
    expect(alerts()).toEqual([]);
    await tap(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(0);
    expect(alerts()).toEqual([OFFLINE_NOTICE]);
    await act(async () => onlineManager.setOnline(true));
    await flush(4);
    expect(alerts()).toEqual([]);
    expect(form.field().value).toBe(form.fieldOf(AFTER));
    expectIdle(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expect(patchBodies(form.patch)[0]).toEqual(form.body(form.fieldOf(AFTER), AFTER));
  });

  it.each([403, 404])('lần đọc lại trả %i: lời nói gian hàng không còn truy cập được (không khẳng định lý do khác), Lưu không gửi; đọc được lại thì Lưu gửi bản mới', async (code) => {
    await mountStage(form);
    state.status.set(ME, code);
    typeInto(form.field(), form.typedFirst);
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    await flush(2);
    await reopen();
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expect(alerts()).toEqual([GONE_NOTICE]);
    state.status.delete(ME);
    state.sf = AFTER;
    await tap(save(form));
    expect(alerts()).toEqual([]);
    expectIdle(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(2);
    expect(patchBodies(form.patch)[1]).toEqual(form.body(form.fieldOf(AFTER), AFTER));
  });

  it('bị máy chủ từ chối (409) rồi tải lại treo quá 4 giây: khoá nhả nhưng Lưu vẫn không gửi tới khi bản mới về', async () => {
    await mountStage(form);
    state.status.set(form.patch, 409);
    const releaseFresh = hold(ME);
    await tap(save(form));
    expect(alerts()).toContain('Lời máy chủ 409');
    expect(writes(form.patch)).toBe(1);
    state.status.delete(form.patch);
    state.sf = AFTER;
    await advance(4_500);
    await flush(2);
    expectBarrier(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    await releaseFresh();
    expect(form.field().value).toBe(form.fieldOf(AFTER));
    await tap(save(form));
    expect(writes(form.patch)).toBe(2);
    expect(patchBodies(form.patch)[1]).toEqual(form.body(form.fieldOf(AFTER), AFTER));
  });

  it('gian hàng không bị làm mới: hàng rào không dựng, Lưu gửi ngay như trước', async () => {
    await mountStage(form);
    expectIdle(save(form));
    typeInto(form.field(), 'Chữ mới');
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    expect(patchBodies(form.patch)[0]).toEqual(form.body('Chữ mới', BEFORE));
  });

  it('cú chạm Lưu cùng khung hình với lệnh làm mới (React chưa vẽ lại) vẫn bị chặn: hàng rào đọc bộ nhớ đệm lúc chạm, không đọc bản đã vẽ', async () => {
    await mountStage(form);
    const releaseFresh = hold(ME);
    const press = save(form);
    act(() => {
      void qc.invalidateQueries({ queryKey: ['my-storefront'] });
      press.click();
    });
    await flush();
    expect(writes(form.patch)).toBe(0);
    await releaseFresh();
  });

  it('lời tại chỗ chỉ hiện sau khi khách chạm Lưu; lần đọc lỗi sau đó không tự hiện lại lời cũ', async () => {
    await mountStage(form);
    state.status.set(ME, 500);
    await tap(save(form));
    await flush(2);
    await reopen();
    expect(alerts()).toEqual([]);
    expect(save(form).getAttribute('aria-disabled')).toBe('true');
    expect(save(form).hasAttribute('aria-busy')).toBe(false);
    await tap(save(form));
    expect(alerts()).toEqual([STALE_NOTICE]);
    state.status.delete(ME);
    await tap(save(form));
    expect(alerts()).toEqual([]);
    state.status.set(ME, 500);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
    });
    await flush();
    expect(alerts()).toEqual([]);
    expect(save(form).getAttribute('aria-disabled')).toBe('true');
  });

  it('bộ nhớ đệm chưa từng có gian hàng (cha truyền sf từ nơi khác): hàng rào không dựng', async () => {
    mounted = render(<>{form.ui(BEFORE as unknown as StorefrontEdit, true, noop)}</>, qc);
    await flush();
    typeInto(form.field(), 'Chữ mới');
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
  });
});

describe('Cấu hình gian hàng: subdomain so với gian hàng đang lưu', () => {
  const form = FORMS[1]!;
  const sub = () => input('input[placeholder="vd: brand1"]');
  const BEFORE_SUB = SF({ subdomainEnabled: true });
  const AFTER_SUB = SF({ subdomainEnabled: true, subdomain: 'brand1', title: 'Tên mới', themeColor: TEAL });

  it('khách gõ lại subdomain vừa lưu khi form còn mang gian hàng cũ: Lưu chờ bản mới, rồi KHÔNG gửi subdomain vì đã trùng bản đang lưu', async () => {
    state.sf = BEFORE_SUB;
    await mountStage(form);
    const releaseFresh = hold(ME);
    typeInto(sub(), 'brand1');
    await tap(save(form));
    expect(patchBodies(form.patch)[0]).toEqual({ title: 'Cửa hàng Xanh', subdomain: 'brand1', themeColor: '#16a34a' });
    state.sf = AFTER_SUB;
    await advance(4_500);
    await flush(2);
    await reopen();
    expect(sub().value).toBe('');
    typeInto(sub(), 'brand1');
    await tap(save(form));
    expect(writes(form.patch)).toBe(1);
    await releaseFresh();
    expect(sub().value).toBe('brand1');
    await tap(save(form));
    expect(writes(form.patch)).toBe(2);
    expect(patchBodies(form.patch)[1]).toEqual({ title: 'Tên mới', themeColor: TEAL });
  });
});

describe('Đổi tên khối: hàng rào là của cả gian hàng', () => {
  const form = FORMS[2]!;

  it('gian hàng đang làm mới thì Lưu của khối khác cũng chờ bản mới, rồi nhả khi bản mới về', async () => {
    await mountStage(form);
    const releaseFresh = hold(ME);
    await act(async () => {
      void qc.invalidateQueries({ queryKey: ['my-storefront'] });
    });
    await flush();
    expectBarrier(save(form));
    await tap(save(form));
    expect(writes(form.patch)).toBe(0);
    await releaseFresh();
    expectIdle(save(form));
  });
});

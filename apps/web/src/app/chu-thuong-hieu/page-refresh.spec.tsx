// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Wave 96B (Mini ↔ web, Wave 76A/80A): khoá của chủ thương hiệu giữ tới khi hồ sơ mới về, có hạn 4 giây; lệnh bị từ chối vì dữ liệu đã cũ
// (khuyến mãi bị xoá ở máy khác...) thì tải lại. Mini chỉ `void refresh()`, web chặt hơn có chủ ý.

type Call = { method: string; path: string; body?: unknown };
type Deferred = { promise: Promise<unknown>; resolve: (v?: unknown) => void };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  getGate: {} as Record<string, () => Promise<unknown> | undefined>,
  write: {} as Record<string, () => unknown>,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'CUSTOMER' } }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/chu-thuong-hieu',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/brand-owner/brand-image-field', () => ({
  BrandImageField: ({ label, onChange }: { label: string; onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('https://res.cloudinary.com/x/new.jpg')}>{label}</button>
  ),
}));
vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown) => {
    m.calls.push({ method, path, body });
    if (method === 'GET') {
      await m.getGate[path]?.();
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    }
    const h = m.write[`${method} ${path}`];
    return h ? h() : {};
  };
  return {
    coreHttp: {
      get: (path: string) => run('GET', path),
      post: (path: string, body?: unknown) => run('POST', path, body),
      patch: (path: string, body?: unknown) => run('PATCH', path, body),
      delete: (path: string) => run('DELETE', path),
    },
  };
});

import BrandOwnerPage from './page';

const OWNER = '/brand/owner/me';
const promo = (id: string, title: string, isActive = true) => ({ id, title, subtitle: null, couponCode: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive });
const brand = (promotions = [promo('p1', 'KM Một'), promo('p2', 'KM Hai')]) => ({
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: null, story: null, origin: null,
  isVerified: true, isPublished: true, followerCount: 12, promotions,
});

const defer = (): Deferred => {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise<unknown>((res) => (resolve = res));
  return { promise, resolve };
};
/** Mọi lần GET hồ sơ kể từ lúc gọi bị giữ tới `release()`; không gọi `release` thì treo mãi. */
const holdOwner = () => {
  const gate = defer();
  m.getGate[OWNER] = () => gate.promise;
  return {
    release: () => {
      delete m.getGate[OWNER];
      gate.resolve();
    },
  };
};
const reject = (status: number, message: string) => () => {
  throw new ApiError(message, status);
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<BrandOwnerPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const calls = (method: string, path: string) => m.calls.filter((c) => c.method === method && c.path === path);
const named = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const btns = (name: RegExp) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((b) => name.test(b.textContent ?? ''));
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const sw = (title: string) => named(`Bật khuyến mãi ${title}`);
const save = () => btns(/^(Lưu thông tin|Đang lưu…)$/)[0]!;
const add = () => btns(/^(Thêm khuyến mãi|Đang thêm…)$/)[0]!;
const upd = () => btns(/^(Lưu thay đổi|Đang lưu…)$/)[0]!;
const del = (title: string) => named(`Xoá khuyến mãi ${title}`);
const confirmDelete = () => btns(/^(Xoá|Đang xoá…)$/).pop()!;
const TITLE = 'Tiêu đề (MUA 2 TẶNG 1)';
const titleInput = () => document.querySelector<HTMLInputElement>(`[aria-label="${TITLE}"]`)!;

beforeEach(() => {
  m.calls = [];
  m.getGate = {};
  m.write = {};
  m.data = { [OWNER]: brand() };
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('/chu-thuong-hieu — Lưu thông tin', () => {
  it('hồ sơ không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây và lưu lại được', async () => {
    useHangTimers();
    await mount();
    holdOwner();
    click(save());
    await flush();
    expect(calls('PATCH', OWNER)).toHaveLength(1);
    await advance(3_500);
    expect(busy(save())).toBe(true);
    click(save());
    await flush();
    expect(calls('PATCH', OWNER)).toHaveLength(1);
    await advance(700);
    expect(busy(save())).toBe(false);
    click(save());
    await flush();
    expect(calls('PATCH', OWNER)).toHaveLength(2);
  });

  it('bị từ chối 400/404/409: lời lỗi hiện ngay, tải lại hồ sơ và giữ khoá tới khi hồ sơ về', async () => {
    for (const status of [400, 404, 409]) {
      m.calls = [];
      m.write[`PATCH ${OWNER}`] = reject(status, 'Hồ sơ đã đổi, tải lại nhé.');
      const r = await mount();
      const gate = holdOwner();
      click(save());
      await flush();
      expect(calls('PATCH', OWNER)).toHaveLength(1);
      expect(alerts()).toContain('Hồ sơ đã đổi, tải lại nhé.');
      expect(calls('GET', OWNER)).toHaveLength(2);
      expect(busy(save())).toBe(true);
      click(save());
      await flush();
      expect(calls('PATCH', OWNER)).toHaveLength(1);
      gate.release();
      await flush();
      expect(busy(save())).toBe(false);
      r.unmount();
      mounted = [];
    }
  });

  it('lỗi 500: hiện lỗi, KHÔNG tải lại hồ sơ, nhả khoá ngay', async () => {
    m.write[`PATCH ${OWNER}`] = reject(500, 'Máy chủ lỗi');
    await mount();
    click(save());
    await flush();
    expect(alerts()).toContain('Máy chủ đang bận');
    expect(calls('GET', OWNER)).toHaveLength(1);
    expect(busy(save())).toBe(false);
  });
});

describe('/chu-thuong-hieu — Thêm và sửa khuyến mãi', () => {
  it('Thêm xong mà hồ sơ không về: còn bận ở 3,5 giây, nhả sau 4 giây', async () => {
    useHangTimers();
    await mount();
    typeInto(titleInput(), 'MUA 3 TẶNG 1');
    holdOwner();
    click(add());
    await flush();
    expect(calls('POST', `${OWNER}/promotions`)).toHaveLength(1);
    await advance(3_500);
    expect(busy(add())).toBe(true);
    await advance(700);
    expect(busy(add())).toBe(false);
  });

  it('Thêm bị từ chối 409: giữ chữ đã nhập, hiện lỗi, tải lại hồ sơ rồi mới nhả khoá', async () => {
    m.write[`POST ${OWNER}/promotions`] = reject(409, 'Trùng khuyến mãi đang chạy.');
    await mount();
    typeInto(titleInput(), 'MUA 3 TẶNG 1');
    const gate = holdOwner();
    click(add());
    await flush();
    expect(alerts()).toContain('Trùng khuyến mãi đang chạy.');
    expect(calls('GET', OWNER)).toHaveLength(2);
    expect(busy(add())).toBe(true);
    expect(titleInput().value).toBe('MUA 3 TẶNG 1');
    gate.release();
    await flush();
    expect(busy(add())).toBe(false);
  });

  it('Sửa xong mà hồ sơ không về: sửa lại đúng khuyến mãi đó còn bị chặn ở 3,5 giây, gửi được sau hạn 4 giây', async () => {
    useHangTimers();
    await mount();
    click(named('Sửa khuyến mãi KM Một'));
    await flush();
    holdOwner();
    click(upd());
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(1);
    await advance(3_500);
    click(named('Sửa khuyến mãi KM Một'));
    await flush();
    click(upd());
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(1);
    await advance(700);
    click(upd());
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(2);
  });

  it('Sửa khuyến mãi đã bị xoá ở máy khác (404): hiện lỗi, tải lại, dòng biến mất mà lời lỗi vẫn còn; giữ khoá tới khi hồ sơ về', async () => {
    m.write[`PATCH ${OWNER}/promotions/p1`] = reject(404, 'Khuyến mãi không còn.');
    await mount();
    click(named('Sửa khuyến mãi KM Một'));
    await flush();
    const gate = holdOwner();
    m.data[OWNER] = brand([promo('p2', 'KM Hai')]);
    click(upd());
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(1);
    expect(alerts()).toContain('Khuyến mãi không còn.');
    expect(calls('GET', OWNER)).toHaveLength(2);
    expect(busy(upd())).toBe(true);
    click(upd());
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(1);
    gate.release();
    await flush();
    expect(document.body.textContent).not.toContain('KM Một');
    expect(alerts()).toContain('Khuyến mãi không còn.');
  });
});

describe('/chu-thuong-hieu — Bật/tắt khuyến mãi', () => {
  it('hồ sơ không bao giờ về: còn bận ở 3,5 giây, nhả sau 4 giây và bật tắt lại được', async () => {
    useHangTimers();
    await mount();
    holdOwner();
    click(sw('KM Một'));
    await flush();
    await advance(3_500);
    expect(busy(sw('KM Một'))).toBe(true);
    click(sw('KM Một'));
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(1);
    await advance(700);
    expect(busy(sw('KM Một'))).toBe(false);
    click(sw('KM Một'));
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(2);
  });

  it('khuyến mãi đã bị xoá ở máy khác (404): hiện lỗi, tải lại, dòng biến mất; giữ khoá tới khi hồ sơ về', async () => {
    m.write[`PATCH ${OWNER}/promotions/p1`] = reject(404, 'Khuyến mãi không còn.');
    await mount();
    const gate = holdOwner();
    m.data[OWNER] = brand([promo('p2', 'KM Hai')]);
    click(sw('KM Một'));
    await flush();
    expect(alerts()).toContain('Khuyến mãi không còn.');
    expect(calls('GET', OWNER)).toHaveLength(2);
    expect(busy(sw('KM Một'))).toBe(true);
    click(sw('KM Một'));
    await flush();
    expect(calls('PATCH', `${OWNER}/promotions/p1`)).toHaveLength(1);
    gate.release();
    await flush();
    expect(document.querySelector('[aria-label="Bật khuyến mãi KM Một"]')).toBeNull();
    expect(alerts()).toContain('Khuyến mãi không còn.');
  });

  it('lỗi 500: không tải lại, nhả khoá ngay', async () => {
    m.write[`PATCH ${OWNER}/promotions/p1`] = reject(500, 'Máy chủ lỗi');
    await mount();
    click(sw('KM Một'));
    await flush();
    expect(alerts()).toContain('Máy chủ đang bận');
    expect(calls('GET', OWNER)).toHaveLength(1);
    expect(busy(sw('KM Một'))).toBe(false);
  });
});

describe('/chu-thuong-hieu — Xoá khuyến mãi', () => {
  it('hồ sơ không bao giờ về: nút Xoá còn bận ở 3,5 giây, nhả sau 4 giây', async () => {
    useHangTimers();
    await mount();
    click(del('KM Một'));
    await flush();
    holdOwner();
    click(confirmDelete());
    await flush();
    expect(calls('DELETE', `${OWNER}/promotions/p1`)).toHaveLength(1);
    await advance(3_500);
    expect(busy(del('KM Một'))).toBe(true);
    await advance(700);
    expect(busy(del('KM Một'))).toBe(false);
  });

  it('khuyến mãi đã bị xoá ở máy khác (404): hộp đóng, hiện lỗi, tải lại và giữ khoá tới khi hồ sơ về', async () => {
    m.write[`DELETE ${OWNER}/promotions/p1`] = reject(404, 'Khuyến mãi không còn.');
    await mount();
    click(del('KM Một'));
    await flush();
    const gate = holdOwner();
    m.data[OWNER] = brand([promo('p2', 'KM Hai')]);
    click(confirmDelete());
    await flush();
    expect(alerts()).toContain('Khuyến mãi không còn.');
    expect(calls('GET', OWNER)).toHaveLength(2);
    expect(busy(del('KM Một'))).toBe(true);
    click(del('KM Một'));
    await flush();
    expect(calls('DELETE', `${OWNER}/promotions/p1`)).toHaveLength(1);
    gate.release();
    await flush();
    expect(document.querySelector('[aria-label="Xoá khuyến mãi KM Một"]')).toBeNull();
    expect(alerts()).toContain('Khuyến mãi không còn.');
  });

  it('lỗi 500: không tải lại, nhả khoá ngay', async () => {
    m.write[`DELETE ${OWNER}/promotions/p1`] = reject(500, 'Máy chủ lỗi');
    await mount();
    click(del('KM Một'));
    await flush();
    click(confirmDelete());
    await flush();
    expect(alerts()).toContain('Máy chủ đang bận');
    expect(calls('GET', OWNER)).toHaveLength(1);
    expect(busy(del('KM Một'))).toBe(false);
  });
});

describe('/chu-thuong-hieu — số', () => {
  it('số người theo dõi dùng tabular-nums', async () => {
    await mount();
    const el = Array.from(document.querySelectorAll('span')).find((s) => /theo dõi$/.test(s.textContent ?? ''));
    expect(el?.textContent).toBe('12 theo dõi');
    expect(el!.classList.contains('tabular-nums')).toBe(true);
  });
});

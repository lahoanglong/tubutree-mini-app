// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Khoá chạm đúp của chủ thương hiệu (Mini ↔ web, Wave 76): lưu thông tin, thêm/sửa/bật-tắt/xoá khuyến mãi. Ca "cùng tick" gọi click
// hai lần trong MỘT act: state chưa kịp vẽ lại giữa hai cú bấm.

type Call = { method: string; path: string; body?: unknown };
type Deferred = { promise: Promise<unknown>; resolve: (v?: unknown) => void; reject: (e: unknown) => void };

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

const promo = (id: string, title: string, isActive = true) => ({ id, title, subtitle: null, couponCode: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive });
const brand = (promotions = [promo('p1', 'KM Một'), promo('p2', 'KM Hai')]) => ({
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: null, story: null, origin: null,
  isVerified: true, isPublished: true, followerCount: 12, promotions,
});

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
const mount = async () => {
  const r = render(<BrandOwnerPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const calls = (method: string, path: string) => m.calls.filter((c) => c.method === method && c.path === path);
const named = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const byLabel = (name: string) => document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
const btns = (name: RegExp) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((b) => name.test(b.textContent ?? ''));
const sameTick = (...els: HTMLElement[]) =>
  act(() => {
    for (const el of els) el.click();
  });
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const field = (text: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === text);
  return document.getElementById(label?.getAttribute('for') ?? '__none__') as HTMLInputElement;
};
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent);
const TITLE = 'Tiêu đề (MUA 2 TẶNG 1)';

beforeEach(() => {
  m.calls = [];
  m.getGate = {};
  m.write = {};
  m.data = { '/brand/owner/me': brand() };
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/chu-thuong-hieu — Lưu thông tin', () => {
  const save = () => btns(/^(Lưu thông tin|Đang lưu…)$/)[0]!;

  it('hai cú bấm cùng tick chỉ gửi một lần; nút aria-busy + aria-disabled, KHÔNG disabled thật', async () => {
    const patch = defer();
    m.write['PATCH /brand/owner/me'] = () => patch.promise;
    await mount();
    sameTick(save(), save());
    await flush();
    expect(calls('PATCH', '/brand/owner/me')).toHaveLength(1);
    expect(busy(save())).toBe(true);
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().disabled).toBe(false);
    patch.resolve({});
    await flush();
  });

  it('gửi đúng hồ sơ lúc bấm dù khách sửa ô trong lúc bay; ô sửa thêm không bị xoá', async () => {
    const patch = defer();
    m.write['PATCH /brand/owner/me'] = () => patch.promise;
    await mount();
    typeInto(field('Câu giới thiệu ngắn'), 'Sống xanh');
    click(save());
    typeInto(field('Câu giới thiệu ngắn'), 'Sống rất xanh');
    patch.resolve({});
    await flush();
    expect((calls('PATCH', '/brand/owner/me')[0]!.body as { tagline: string }).tagline).toBe('Sống xanh');
    expect(field('Câu giới thiệu ngắn').value).toBe('Sống rất xanh');
  });

  it('khoá giữ tới khi hồ sơ mới về: PATCH xong mà tải lại còn treo thì bấm lần hai vẫn bị chặn', async () => {
    await mount();
    const gate = holdGet('/brand/owner/me');
    click(save());
    await flush();
    expect(calls('PATCH', '/brand/owner/me')).toHaveLength(1);
    expect(busy(save())).toBe(true);
    click(save());
    await flush();
    expect(calls('PATCH', '/brand/owner/me')).toHaveLength(1);
    gate.release();
    await flush();
    expect(busy(save())).toBe(false);
    click(save());
    await flush();
    expect(calls('PATCH', '/brand/owner/me')).toHaveLength(2);
  });

  it('lỗi: role=alert, nhả khoá để lưu lại', async () => {
    let n = 0;
    m.write['PATCH /brand/owner/me'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return {};
    };
    await mount();
    click(save());
    await flush();
    expect(alerts()).toEqual(['Mất kết nối']);
    expect(busy(save())).toBe(false);
    click(save());
    await flush();
    expect(calls('PATCH', '/brand/owner/me')).toHaveLength(2);
  });
});

describe('/chu-thuong-hieu — thêm và sửa khuyến mãi', () => {
  const add = () => btns(/^(Thêm khuyến mãi|Đang thêm…)$/)[0]!;
  const upd = () => btns(/^(Lưu thay đổi|Đang lưu…)$/)[0]!;

  it('Thêm: hai cú bấm cùng tick chỉ một POST; aria-busy, KHÔNG disabled', async () => {
    const post = defer();
    m.write['POST /brand/owner/me/promotions'] = () => post.promise;
    await mount();
    typeInto(byLabel(TITLE), 'Giảm sốc');
    sameTick(add(), add());
    await flush();
    expect(calls('POST', '/brand/owner/me/promotions')).toHaveLength(1);
    expect(busy(add())).toBe(true);
    expect(add().disabled).toBe(false);
    post.resolve({});
    await flush();
  });

  it('Thêm xong: form được dọn khi vẫn là bản vừa gửi; gõ thêm trong lúc gửi thì giữ chữ đó', async () => {
    const post = defer();
    m.write['POST /brand/owner/me/promotions'] = () => post.promise;
    await mount();
    typeInto(byLabel(TITLE), 'Giảm sốc');
    click(add());
    typeInto(byLabel(TITLE), 'Giảm sốc thật');
    post.resolve({});
    await flush();
    expect(byLabel(TITLE).value).toBe('Giảm sốc thật');

    const second = defer();
    m.write['POST /brand/owner/me/promotions'] = () => second.promise;
    click(add());
    second.resolve({});
    await flush();
    expect(byLabel(TITLE).value).toBe('');
  });

  it('Thêm xong: khoá giữ tới khi danh sách mới về, gõ khuyến mãi mới trong lúc đó và bấm Thêm vẫn bị chặn', async () => {
    await mount();
    typeInto(byLabel(TITLE), 'Giảm sốc');
    const gate = holdGet('/brand/owner/me');
    click(add());
    await flush();
    expect(calls('POST', '/brand/owner/me/promotions')).toHaveLength(1);
    typeInto(byLabel(TITLE), 'Giảm sốc hai');
    expect(busy(add())).toBe(true);
    click(add());
    await flush();
    expect(calls('POST', '/brand/owner/me/promotions')).toHaveLength(1);
    gate.release();
    await flush();
    click(add());
    await flush();
    expect(calls('POST', '/brand/owner/me/promotions')).toHaveLength(2);
  });

  it('Thêm lỗi: role=alert, nhả khoá, giữ nguyên chữ để gửi lại', async () => {
    let n = 0;
    m.write['POST /brand/owner/me/promotions'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mã chưa có trong hệ thống');
      return {};
    };
    await mount();
    typeInto(byLabel(TITLE), 'Giảm sốc');
    click(add());
    await flush();
    expect(alerts()).toEqual(['Mã chưa có trong hệ thống']);
    expect(byLabel(TITLE).value).toBe('Giảm sốc');
    expect(busy(add())).toBe(false);
    click(add());
    await flush();
    expect(calls('POST', '/brand/owner/me/promotions')).toHaveLength(2);
  });

  it('Sửa: hai cú bấm Lưu thay đổi cùng tick chỉ một PATCH, gửi đúng bản lúc bấm; xong thì thoát chế độ sửa', async () => {
    const patch = defer();
    m.write['PATCH /brand/owner/me/promotions/p1'] = () => patch.promise;
    await mount();
    click(named('Sửa khuyến mãi KM Một'));
    typeInto(byLabel(TITLE), 'KM Một mới');
    sameTick(upd(), upd());
    await flush();
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')).toHaveLength(1);
    expect(busy(upd())).toBe(true);
    expect(upd().disabled).toBe(false);
    patch.resolve({});
    await flush();
    expect((calls('PATCH', '/brand/owner/me/promotions/p1')[0]!.body as { title: string }).title).toBe('KM Một mới');
    expect(btns(/^Lưu thay đổi$/)).toHaveLength(0);
    expect(byLabel(TITLE).value).toBe('');
  });

  it('Sửa xong mà khách đã gõ khác trong lúc gửi: giữ chế độ sửa và chữ mới', async () => {
    const patch = defer();
    m.write['PATCH /brand/owner/me/promotions/p1'] = () => patch.promise;
    await mount();
    click(named('Sửa khuyến mãi KM Một'));
    typeInto(byLabel(TITLE), 'KM Một mới');
    click(upd());
    typeInto(byLabel(TITLE), 'KM Một mới nữa');
    patch.resolve({});
    await flush();
    expect(byLabel(TITLE).value).toBe('KM Một mới nữa');
    expect(btns(/^Lưu thay đổi$/)).toHaveLength(1);
  });
});

describe('/chu-thuong-hieu — bật/tắt khuyến mãi theo id', () => {
  const sw = (name: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="Bật khuyến mãi ${name}"]`)!;

  it('cùng một khuyến mãi hai cú bấm cùng tick chỉ một PATCH; khuyến mãi khác vẫn chạy song song', async () => {
    const a = defer();
    m.write['PATCH /brand/owner/me/promotions/p1'] = () => a.promise;
    await mount();
    sameTick(sw('KM Một'), sw('KM Một'));
    await flush();
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')).toHaveLength(1);
    click(sw('KM Hai'));
    await flush();
    expect(calls('PATCH', '/brand/owner/me/promotions/p2')).toHaveLength(1);
    a.resolve({});
    await flush();
  });

  it('báo bận ở MỌI khuyến mãi đang bay, khuyến mãi rảnh thì không; công tắc không disabled thật', async () => {
    const a = defer();
    const b = defer();
    m.write['PATCH /brand/owner/me/promotions/p1'] = () => a.promise;
    m.write['PATCH /brand/owner/me/promotions/p2'] = () => b.promise;
    m.data['/brand/owner/me'] = brand([promo('p1', 'KM Một'), promo('p2', 'KM Hai'), promo('p3', 'KM Ba')]);
    await mount();
    click(sw('KM Một'));
    await flush();
    expect([sw('KM Một'), sw('KM Hai'), sw('KM Ba')].map(busy)).toEqual([true, false, false]);
    click(sw('KM Hai'));
    await flush();
    expect([sw('KM Một'), sw('KM Hai'), sw('KM Ba')].map(busy)).toEqual([true, true, false]);
    expect(sw('KM Một').disabled).toBe(false);
    expect(sw('KM Một').getAttribute('aria-disabled')).toBe('true');
    a.resolve({});
    b.resolve({});
    await flush();
  });

  it('khoá giữ tới khi danh sách mới về: lần chạm hai không lật từ giá trị cũ', async () => {
    await mount();
    const gate = holdGet('/brand/owner/me');
    click(sw('KM Một'));
    await flush();
    expect(sw('KM Một').getAttribute('aria-checked')).toBe('true');
    click(sw('KM Một'));
    await flush();
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')).toHaveLength(1);
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')[0]!.body).toEqual({ isActive: false });
    m.data['/brand/owner/me'] = brand([promo('p1', 'KM Một', false), promo('p2', 'KM Hai')]);
    gate.release();
    await flush();
    expect(sw('KM Một').getAttribute('aria-checked')).toBe('false');
    click(sw('KM Một'));
    await flush();
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')[1]!.body).toEqual({ isActive: true });
  });

  it('lỗi: role=alert, nhả khoá để thử lại', async () => {
    let n = 0;
    m.write['PATCH /brand/owner/me/promotions/p1'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return {};
    };
    await mount();
    click(sw('KM Một'));
    await flush();
    expect(alerts()).toEqual(['Mất kết nối']);
    expect(busy(sw('KM Một'))).toBe(false);
    click(sw('KM Một'));
    await flush();
    expect(calls('PATCH', '/brand/owner/me/promotions/p1')).toHaveLength(2);
  });
});

describe('/chu-thuong-hieu — xoá khuyến mãi (không hoàn tác)', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const confirmBtn = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^(Xoá|Đang xoá…)$/.test(b.textContent ?? ''))!;
  const cancelBtn = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Huỷ')!;
  const esc = () =>
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  const openConfirm = async (name: string) => {
    click(named(`Xoá khuyến mãi ${name}`));
    await flush();
  };

  it('hai cú bấm Xoá cùng tick chỉ một DELETE; nút aria-busy, KHÔNG disabled; hộp không đóng được (Esc, Huỷ, X) khi đang gửi', async () => {
    const del = defer();
    m.write['DELETE /brand/owner/me/promotions/p1'] = () => del.promise;
    await mount();
    await openConfirm('KM Một');
    sameTick(confirmBtn(), confirmBtn());
    await flush();
    expect(calls('DELETE', '/brand/owner/me/promotions/p1')).toHaveLength(1);
    expect(busy(confirmBtn())).toBe(true);
    expect(confirmBtn().disabled).toBe(false);
    esc();
    click(cancelBtn());
    expect(dialog()).not.toBeNull();
    del.resolve({});
    await flush();
    expect(dialog()).toBeNull();
  });

  it('khoá giữ tới khi danh sách mới về: DELETE xong mà tải lại treo thì mở lại và bấm Xoá vẫn bị chặn', async () => {
    await mount();
    const gate = holdGet('/brand/owner/me');
    await openConfirm('KM Một');
    click(confirmBtn());
    await flush();
    expect(calls('DELETE', '/brand/owner/me/promotions/p1')).toHaveLength(1);
    expect(busy(named('Xoá khuyến mãi KM Một'))).toBe(true);
    click(named('Xoá khuyến mãi KM Một'));
    await flush();
    expect(dialog()).toBeNull();
    m.data['/brand/owner/me'] = brand([promo('p2', 'KM Hai')]);
    gate.release();
    await flush();
    expect(named('Xoá khuyến mãi KM Một')).toBeNull();
  });

  it('khoá theo id: xoá KM một xong mà danh sách còn treo thì vẫn xoá được KM hai (khác id), KM một thì bị chặn', async () => {
    await mount();
    const gate = holdGet('/brand/owner/me');
    await openConfirm('KM Một');
    click(confirmBtn());
    await flush();
    expect(dialog()).toBeNull();
    await openConfirm('KM Hai');
    click(confirmBtn());
    await flush();
    expect(calls('DELETE', '/brand/owner/me/promotions/p2')).toHaveLength(1);
    gate.release();
    await flush();
  });

  it('lỗi: role=alert, hộp đóng, nhả khoá để xoá lại', async () => {
    let n = 0;
    m.write['DELETE /brand/owner/me/promotions/p1'] = () => {
      n += 1;
      if (n === 1) throw new Error('Mất kết nối');
      return {};
    };
    await mount();
    await openConfirm('KM Một');
    click(confirmBtn());
    await flush();
    expect(alerts()).toEqual(['Mất kết nối']);
    expect(dialog()).toBeNull();
    await openConfirm('KM Một');
    click(confirmBtn());
    await flush();
    expect(calls('DELETE', '/brand/owner/me/promotions/p1')).toHaveLength(2);
  });

  it('xoá khuyến mãi B trong lúc đang sửa dở A: form của A còn nguyên; xoá đúng khuyến mãi đang sửa thì dọn form', async () => {
    await mount();
    click(named('Sửa khuyến mãi KM Một'));
    typeInto(byLabel(TITLE), 'KM Một đang sửa');
    await openConfirm('KM Hai');
    click(confirmBtn());
    await flush();
    expect(byLabel(TITLE).value).toBe('KM Một đang sửa');

    m.data['/brand/owner/me'] = brand([promo('p1', 'KM Một')]);
    await openConfirm('KM Một');
    click(confirmBtn());
    await flush();
    expect(byLabel(TITLE).value).toBe('');
    expect(btns(/^Lưu thay đổi$/)).toHaveLength(0);
  });
});

describe('/chu-thuong-hieu — Thử lại khi tải lỗi', () => {
  it('hai cú bấm Thử lại cùng tick chỉ tải lại một lần', async () => {
    delete m.data['/brand/owner/me'];
    await mount();
    const before = calls('GET', '/brand/owner/me').length;
    const gate = defer();
    m.getGate['/brand/owner/me'] = () => gate.promise;
    const retry = btns(/^Thử lại$/)[0]!;
    await captureUnhandledRejections(async () => {
      sameTick(retry, retry);
      await flush();
    });
    expect(calls('GET', '/brand/owner/me').length - before).toBe(1);
    gate.resolve();
    await flush();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));

import VouchersPage from './page';

const open = (sp: Record<string, string | string[] | undefined>) => VouchersPage({ searchParams: Promise.resolve(sp) });

describe('/ma-giam-gia (chuyển hướng vào hub Ưu đãi)', () => {
  beforeEach(() => h.redirect.mockClear());

  it.each([
    [{}, '/uu-dai?tab=deals&codes=all'],
    [{ tab: 'claim' }, '/uu-dai?tab=deals&codes=all'],
    [{ code: 'X' }, '/uu-dai?tab=deals&codes=all&code=X'],
    [{ tab: 'mine' }, '/uu-dai?tab=wallet'],
    [{ tab: 'history', code: 'X' }, '/uu-dai?tab=wallet&history=1&code=X'],
    [{ tab: 'la' }, '/uu-dai?tab=deals&codes=all'],
  ])('%j → %s', async (sp, to) => {
    await open(sp);
    expect(h.redirect).toHaveBeenCalledTimes(1);
    expect(h.redirect).toHaveBeenCalledWith(to);
  });

  it('giữ tham số lặp và giá trị có ký tự đặc biệt (đọc lại ra đúng giá trị gốc)', async () => {
    await open({ utm_source: ['zns', 'zalo'], code: 'GIẢM 10&X', empty: undefined });
    const to = new URL(h.redirect.mock.calls[0]![0] as string, 'https://tubutree.com');
    expect(to.pathname).toBe('/uu-dai');
    expect(to.searchParams.getAll('utm_source')).toEqual(['zns', 'zalo']);
    expect(to.searchParams.get('code')).toBe('GIẢM 10&X');
    expect(to.searchParams.has('empty')).toBe(false);
  });
});

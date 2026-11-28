// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const state = vi.hoisted(() => ({
  gets: [] as string[],
  byPlacement: {} as Record<string, unknown[]>,
  fail: false,
}));

vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string, opts?: { query?: { placement?: string } }) => {
      state.gets.push(`${path}?${opts?.query?.placement ?? ''}`);
      if (path === '/campaigns') {
        if (state.fail) throw new Error('mạng lỗi');
        return state.byPlacement[opts?.query?.placement ?? ''] ?? [];
      }
      return [];
    },
  },
}));

import { LinkBuilderSheet } from './link-builder-sheet';

const DAY = 86_400_000;
const banner = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `cd-${id}`,
  title,
  image: 'https://img.test/x.jpg',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: new Date(Date.now() - DAY).toISOString(),
  endAt: new Date(Date.now() + DAY).toISOString(),
  ...over,
});

let mounted: Rendered[] = [];
const onCreate = vi.fn();
const mount = async () => {
  const r = render(<LinkBuilderSheet open onClose={() => {}} busy={false} error={null} onCreate={onCreate} />);
  mounted.push(r);
  await flush();
  return r;
};
const dialog = () => document.querySelector('[role="dialog"]')!;
const tab = (name: string) => Array.from(dialog().querySelectorAll<HTMLElement>('[role="tab"], button')).find((b) => b.textContent?.trim() === name)!;
const submit = () => Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === 'Tạo link') as HTMLButtonElement;
const radios = () => Array.from(dialog().querySelectorAll<HTMLElement>('[role="radio"]')).map((r) => r.textContent);

beforeEach(() => {
  state.gets = [];
  state.fail = false;
  state.byPlacement = { HOME_TOP: [banner('c1', 'Giữa Thu')], OFFERS_TOP: [banner('c2', 'Tuần lễ đổi rác'), banner('c1', 'Giữa Thu')] };
  onCreate.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('LinkBuilderSheet (web): đích Chiến dịch và Bộ quà tặng', () => {
  it('có đủ sáu đích; chưa chọn Chiến dịch thì không gọi API chiến dịch', async () => {
    await mount();
    for (const name of ['Trang chủ', 'Sản phẩm', 'Danh mục', 'Giờ vàng', 'Chiến dịch', 'Bộ quà tặng']) expect(tab(name), name).toBeDefined();
    expect(state.gets.filter((g) => g.startsWith('/campaigns'))).toEqual([]);
  });

  it('Chiến dịch: gộp banner Trang chủ và Ưu đãi, bỏ trùng; nút Tạo link khoá tới khi chọn, rồi gửi targetId là id chiến dịch', async () => {
    await mount();
    click(tab('Chiến dịch'));
    await flush();
    expect(radios()).toEqual(['Giữa Thu', 'Tuần lễ đổi rác']);
    expect(submit().disabled).toBe(true);
    click(dialog().querySelectorAll('[role="radio"]')[1]!);
    expect(submit().disabled).toBe(false);
    click(submit());
    expect(onCreate).toHaveBeenCalledWith({ targetType: 'CAMPAIGN', targetId: 'c2' });
  });

  it('Chiến dịch đã quá hạn nằm trong bộ nhớ đệm không được chọn; hết chiến dịch thì một câu báo và không tạo được', async () => {
    state.byPlacement = { HOME_TOP: [banner('old', 'Đã hết hạn', { endAt: new Date(Date.now() - 1000).toISOString() })], OFFERS_TOP: [] };
    await mount();
    click(tab('Chiến dịch'));
    await flush();
    expect(radios()).toEqual([]);
    expect(dialog().textContent).toContain('Chưa có chiến dịch nào đang chạy.');
    expect(submit().disabled).toBe(true);
  });

  it('tải chiến dịch lỗi: báo lỗi kèm Thử lại, không hiện danh sách', async () => {
    state.fail = true;
    await mount();
    click(tab('Chiến dịch'));
    await flush();
    expect(radios()).toEqual([]);
    expect(dialog().textContent).toContain('Thử lại');
  });

  it('đổi sang đích khác thì bỏ lựa chọn chiến dịch đã chọn', async () => {
    await mount();
    click(tab('Chiến dịch'));
    await flush();
    click(dialog().querySelectorAll('[role="radio"]')[0]!);
    click(tab('Trang chủ'));
    click(tab('Chiến dịch'));
    await flush();
    expect(submit().disabled).toBe(true);
  });

  it('Bộ quà tặng: một câu giới thiệu, không cần chọn gì, tạo link không mang targetId', async () => {
    await mount();
    click(tab('Bộ quà tặng'));
    expect(dialog().textContent).toContain('Khách mở trang Bộ quà tặng & combo.');
    expect(submit().disabled).toBe(false);
    click(submit());
    expect(onCreate).toHaveBeenCalledWith({ targetType: 'COMBO' });
    expect(state.gets.filter((g) => g.startsWith('/campaigns'))).toEqual([]);
  });
});

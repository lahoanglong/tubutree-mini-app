import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../../services/storefront-api', () => ({ pickerProducts: vi.fn(async () => []) }));
vi.mock('../../services/shop-api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchCategories: vi.fn(async () => []) }));

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

const onCreate = vi.fn();
let byPlacement: Record<string, unknown[]> = {};
let fail = false;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LinkBuilderSheet open onClose={() => {}} busy={false} error={null} onCreate={onCreate} />
    </QueryClientProvider>,
  );
}
const tab = (name: string) => screen.getByRole('tab', { name });
const radios = () => screen.queryAllByRole('radio').map((r) => r.textContent);
const submit = () => screen.getByRole('button', { name: 'Tạo link' }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  fail = false;
  byPlacement = { HOME_TOP: [banner('c1', 'Giữa Thu')], OFFERS_TOP: [banner('c2', 'Tuần lễ đổi rác'), banner('c1', 'Giữa Thu')] };
  mocks.get.mockImplementation(async (path: string, opts?: { query?: { placement?: string } }) => {
    if (path !== '/campaigns') return [];
    if (fail) throw new Error('mạng lỗi');
    return byPlacement[opts?.query?.placement ?? ''] ?? [];
  });
});

describe('LinkBuilderSheet (Mini): đích Chiến dịch và Bộ quà tặng', () => {
  it('có đủ sáu đích; chưa chọn Chiến dịch thì không gọi API chiến dịch', () => {
    mount();
    for (const name of ['Trang chủ', 'Sản phẩm', 'Danh mục', 'Giờ vàng', 'Chiến dịch', 'Bộ quà tặng']) expect(tab(name), name).toBeInTheDocument();
    expect(mocks.get.mock.calls.filter(([p]) => p === '/campaigns')).toEqual([]);
  });

  it('Chiến dịch: gộp banner Trang chủ và Ưu đãi, bỏ trùng; Tạo link khoá tới khi chọn, rồi gửi targetId là id chiến dịch', async () => {
    mount();
    fireEvent.click(tab('Chiến dịch'));
    await waitFor(() => expect(radios()).toEqual(['Giữa Thu', 'Tuần lễ đổi rác']));
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(onCreate).toHaveBeenCalledWith({ targetType: 'CAMPAIGN', targetId: 'c2' });
  });

  it('hết chiến dịch đang chạy: một câu báo, không tạo được', async () => {
    byPlacement = { HOME_TOP: [banner('old', 'Đã hết hạn', { endAt: new Date(Date.now() - 1000).toISOString() })], OFFERS_TOP: [] };
    mount();
    fireEvent.click(tab('Chiến dịch'));
    expect(await screen.findByText('Chưa có chiến dịch nào đang chạy.')).toBeInTheDocument();
    expect(radios()).toEqual([]);
    expect(submit().disabled).toBe(true);
  });

  it('tải chiến dịch lỗi: báo lỗi kèm Thử lại', async () => {
    fail = true;
    mount();
    fireEvent.click(tab('Chiến dịch'));
    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(radios()).toEqual([]);
  });

  it('đổi sang đích khác rồi quay lại: bỏ lựa chọn chiến dịch đã chọn', async () => {
    mount();
    fireEvent.click(tab('Chiến dịch'));
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    await act(async () => {
      fireEvent.click(tab('Trang chủ'));
    });
    fireEvent.click(tab('Chiến dịch'));
    await waitFor(() => expect(radios()).toHaveLength(2));
    expect(submit().disabled).toBe(true);
  });

  it('Bộ quà tặng: một câu giới thiệu, không cần chọn gì, tạo link không mang targetId', () => {
    mount();
    fireEvent.click(tab('Bộ quà tặng'));
    expect(screen.getByText('Khách mở trang Bộ quà tặng & combo.')).toBeInTheDocument();
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(onCreate).toHaveBeenCalledWith({ targetType: 'COMBO' });
    expect(mocks.get.mock.calls.filter(([p]) => p === '/campaigns')).toEqual([]);
  });
});

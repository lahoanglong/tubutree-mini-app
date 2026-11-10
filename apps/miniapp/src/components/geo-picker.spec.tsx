import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';

const mocks = vi.hoisted(() => ({ getProvinces: vi.fn(), getCommunes: vi.fn() }));
vi.mock('../services/geo-api', () => ({ getProvinces: mocks.getProvinces, getCommunes: mocks.getCommunes }));

import { GeoPicker, EMPTY_GEO, filterGeoOptions, type GeoValue } from './geo-picker';

const WARDS = [
  { code: 'w1', name: 'Phường Ba Đình' },
  { code: 'w2', name: 'Phường Đống Đa' },
  { code: 'w3', name: 'Xã Thanh Trì' },
];

describe('filterGeoOptions (R6-BUYER-11)', () => {
  it('không phân biệt dấu và hoa/thường', () => {
    expect(filterGeoOptions(WARDS, 'dong da').map((o) => o.code)).toEqual(['w2']);
    expect(filterGeoOptions(WARDS, 'BA ĐÌNH').map((o) => o.code)).toEqual(['w1']);
    expect(filterGeoOptions(WARDS, 'phuong').map((o) => o.code)).toEqual(['w1', 'w2']);
  });
  it('ô tìm trống hoặc chỉ khoảng trắng: giữ nguyên danh sách', () => {
    expect(filterGeoOptions(WARDS, '')).toHaveLength(3);
    expect(filterGeoOptions(WARDS, '  ')).toHaveLength(3);
  });
});

function Harness({ onValue }: { onValue: (v: GeoValue) => void }) {
  const [v, setV] = useState<GeoValue>({ province: 'Hà Nội', provinceCode: 'p1', ward: '', wardCode: '' });
  return (
    <GeoPicker
      value={v}
      onChange={(n) => {
        setV(n);
        onValue(n);
      }}
    />
  );
}

function renderHarness(onValue = vi.fn()) {
  mocks.getProvinces.mockResolvedValue([{ code: 'p1', name: 'Hà Nội' }]);
  mocks.getCommunes.mockResolvedValue(WARDS);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness onValue={onValue} />
    </QueryClientProvider>,
  );
  return onValue;
}

describe('GeoPicker: tìm phường/xã', () => {
  it('gõ không dấu lọc danh sách; chọn một dòng thì trả đúng tên + mã và đóng bảng', async () => {
    const onValue = renderHarness();
    await waitFor(() => expect(mocks.getCommunes).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Phường\/Xã/ }));
    const list = await screen.findByRole('listbox', { name: 'Phường/Xã' });
    expect(within(list).getAllByRole('option')).toHaveLength(3);

    fireEvent.change(screen.getByRole('searchbox', { name: /Tìm phường/i }), { target: { value: 'dong DA' } });
    const options = within(screen.getByRole('listbox', { name: 'Phường/Xã' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Phường Đống Đa']);

    fireEvent.click(options[0]!);
    expect(onValue).toHaveBeenLastCalledWith({ province: 'Hà Nội', provinceCode: 'p1', ward: 'Phường Đống Đa', wardCode: 'w2' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Phường/Xã' })).not.toBeInTheDocument());
  });

  it('không khớp: báo không tìm thấy', async () => {
    renderHarness();
    await waitFor(() => expect(mocks.getCommunes).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Phường\/Xã/ }));
    fireEvent.change(await screen.findByRole('searchbox', { name: /Tìm phường/i }), { target: { value: 'zzz' } });
    expect(screen.getByText('Không tìm thấy kết quả phù hợp')).toBeInTheDocument();
  });

  it('nhãn hai ô chọn dùng bậc field-label (12px/1,33/500) như nhãn của Field', async () => {
    renderHarness();
    await waitFor(() => expect(mocks.getCommunes).toHaveBeenCalled());
    for (const name of ['Tỉnh/Thành phố', 'Phường/Xã']) {
      const el = screen.getAllByText(name).find((e) => e.style.fontSize !== '')!;
      expect(el.style.fontSize).toBe('var(--type-field-label-size)');
      expect(el.style.fontWeight).toBe('var(--type-field-label-weight)');
    }
  });

  it('chưa chọn tỉnh: ô Phường/Xã bị khoá', () => {
    mocks.getProvinces.mockResolvedValue([]);
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <GeoPicker value={EMPTY_GEO} onChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /^Phường\/Xã/ })).toBeDisabled();
  });
});

describe('GeoPicker: "Thử lại" khi tải tỉnh/phường lỗi (kiểm hồi quy, W88A không đổi nguồn)', () => {
  it('chạm đúp cùng một khung hình vào mỗi nút Thử lại chỉ gọi lại API một lần (query-core gộp refetch của truy vấn chưa có dữ liệu)', async () => {
    let provincesReady: (v: unknown) => void = () => undefined;
    let communesReady: (v: unknown) => void = () => undefined;
    mocks.getProvinces.mockReset().mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(new Promise((r) => (provincesReady = r)));
    mocks.getCommunes.mockReset().mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(new Promise((r) => (communesReady = r)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness onValue={vi.fn()} />
      </QueryClientProvider>,
    );
    const [provincesRetry, communesRetry] = await screen.findAllByRole('button', { name: /Thử lại/ });
    await act(async () => {
      fireEvent.click(provincesRetry!);
      fireEvent.click(provincesRetry!);
    });
    await act(async () => {
      fireEvent.click(communesRetry!);
      fireEvent.click(communesRetry!);
    });
    expect(mocks.getProvinces).toHaveBeenCalledTimes(2);
    expect(mocks.getCommunes).toHaveBeenCalledTimes(2);
    await act(async () => {
      provincesReady([{ code: 'p1', name: 'Hà Nội' }]);
      communesReady(WARDS);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull());
  });
});

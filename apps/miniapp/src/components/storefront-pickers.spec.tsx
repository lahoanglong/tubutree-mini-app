import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  addItem: vi.fn(),
  pickerProducts: vi.fn(),
  getStorefrontCategories: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/storefront-api', () => ({
  addItem: mocks.addItem,
  pickerProducts: mocks.pickerProducts,
  getStorefrontCategories: mocks.getStorefrontCategories,
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { PickerSheet } from './storefront-pickers';
import { HttpError } from '../services/http';

type Deferred = { promise: Promise<unknown>; resolve: () => void; reject: (e: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = () => res({}); reject = rej; });
  return { promise, resolve, reject };
};
const conflict = () => new HttpError('Vừa có thay đổi, bạn thử lại nhé', undefined, { status: 409, data: { message: 'Vừa có thay đổi, bạn thử lại nhé' }, headers: {} });
const products = ['pA', 'pB'].map((id, i) => ({
  id, name: i === 0 ? 'Món A' : 'Món B', slug: id, thumbnail: null, brand: 'Tubu', basePrice: 100_000, salePrice: null,
  ratingAvg: 5, reviewCount: 1, inStock: true, maxAffiliateRate: 0,
}));
// TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function renderPicker(onStale: () => PromiseLike<unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PickerSheet collectionId="c1" onAdded={vi.fn()} onStale={onStale} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}
async function addButtons() {
  await screen.findByText('Món A');
  const [a, b] = screen.getAllByRole('button', { name: 'Thêm' }) as HTMLButtonElement[];
  return { a: a!, b: b! };
}
const callsFor = (id: string) => mocks.addItem.mock.calls.filter(([, dto]) => (dto as { productId: string }).productId === id).length;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pickerProducts.mockResolvedValue(products);
  mocks.getStorefrontCategories.mockResolvedValue([]);
});

describe('PickerSheet: nút Thêm bận theo từng món (W113A)', () => {
  it('chạm A rồi B (A còn chạy): cả hai nút cùng bận, chạm lại A bị bỏ qua; B xong thì B rảnh còn A vẫn bận', async () => {
    const byId: Record<string, Deferred> = { pA: deferred(), pB: deferred() };
    mocks.addItem.mockImplementation((_c: string, dto: { productId: string }) => byId[dto.productId]!.promise);
    renderPicker(() => Promise.resolve());
    const { a, b } = await addButtons();

    fireEvent.click(a);
    fireEvent.click(b);
    await waitFor(() => expect(a).toHaveAttribute('aria-busy', 'true'));
    expect(b).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(a);
    fireEvent.click(a);
    await settle();
    expect(callsFor('pA')).toBe(1);
    expect(callsFor('pB')).toBe(1);

    await act(async () => byId.pB!.resolve());
    await settle();
    expect(b).not.toHaveAttribute('aria-busy');
    expect(a).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(a);
    await settle();
    expect(callsFor('pA')).toBe(1);

    await act(async () => byId.pA!.resolve());
    await settle();
    expect(a).not.toHaveAttribute('aria-busy');
  });

  it('A bị từ chối 409 rồi chạm B: A giữ bận tới khi dữ liệu tải lại về, B (đã xong) rảnh, chạm A lúc đó không gửi lần hai', async () => {
    const reload = deferred();
    const bDone = deferred();
    mocks.addItem.mockImplementation((_c: string, dto: { productId: string }) => (dto.productId === 'pA' ? Promise.reject(conflict()) : bDone.promise));
    const onStale = vi.fn(() => reload.promise);
    renderPicker(onStale);
    const { a, b } = await addButtons();

    fireEvent.click(a);
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'error')).toHaveLength(1);
    fireEvent.click(b);
    await act(async () => bDone.resolve());
    await settle();

    expect(b).not.toHaveAttribute('aria-busy');
    expect(a).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(a);
    await settle();
    expect(callsFor('pA')).toBe(1);

    await act(async () => reload.resolve());
    await settle();
    expect(a).not.toHaveAttribute('aria-busy');
    mocks.addItem.mockResolvedValue({});
    fireEvent.click(a);
    await waitFor(() => expect(callsFor('pA')).toBe(2));
  });

  it('mất mạng: không tải lại, nút nhả ngay', async () => {
    mocks.addItem.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK')).mockResolvedValue({});
    const onStale = vi.fn(() => Promise.resolve());
    renderPicker(onStale);
    const { a } = await addButtons();

    fireEvent.click(a);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await settle();
    expect(onStale).not.toHaveBeenCalled();
    expect(a).not.toHaveAttribute('aria-busy');
    fireEvent.click(a);
    await waitFor(() => expect(callsFor('pA')).toBe(2));
  });
});

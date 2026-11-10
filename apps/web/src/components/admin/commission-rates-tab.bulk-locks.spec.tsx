// @vitest-environment jsdom
import { act } from 'react';
import { useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommissionRatesTab } from './commission-rates-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { CommissionRatesPage } from '@/lib/commission-rates';

// W96B: bốn lệnh ghi hàng loạt của tab "Hoa hồng & giá sỉ" (TIỀN: hoa hồng CTV, giá sỉ đại lý): áp % cho biến thể chưa có %, đặt % cho cả sản phẩm,
// nhập CSV % và nhập CSV giá sỉ. Mỗi lệnh giữ khoá tới khi danh sách tải lại xong (tối đa 4 giây). Cả bốn lệnh đều có ô người dùng nhập (số %, CSV) nên 400 là
// lỗi nhập liệu: hiện tại form, không tải lại, nhả khoá ngay; chỉ 404/409 là dữ liệu cũ (tải lại, chờ ≤4 giây). Test dựng QueryClient trần, không có MutationCache như
// production (ở đó khoá admin-* vẫn bị làm cũ sau mỗi lệnh), nên "không tải lại" ở đây là lệnh không tự gọi và không chờ tải lại. Nút bận báo bằng
// aria-busy/aria-disabled thay disabled, ô nhập đang gửi chỉ readOnly để Enter không làm rơi tiêu điểm; ô chọn bậc giá sỉ khoá khi xem trước/ghi còn chạy.

const PAGE: CommissionRatesPage = {
  items: [
    {
      id: 'p1',
      name: 'Nước rửa chén',
      thumbnail: null,
      brand: 'Tubu Tree',
      isActive: true,
      affiliateBlocked: false,
      approvalStatus: 'APPROVED',
      isPartner: false,
      variations: [
        { id: 'v1', sku: 'NRC-500', name: '500ml', retailPrice: 100_000, salePrice: null, isActive: true, affiliateRate: null, dealerPrices: null },
        { id: 'v2', sku: 'NRC-1L', name: '1 lít', retailPrice: 180_000, salePrice: null, isActive: true, affiliateRate: null, dealerPrices: null },
      ],
    },
  ],
  nextCursor: null,
  maxRate: 50,
  defaultRate: 8,
  summary: { missing: 2, missingTubu: 2 },
};
const TIER = { id: 't1', name: 'Đại lý Bạc', minOrderVolume: 10_000_000, creditLimit: 0, paymentTerms: null };
const TIER2 = { id: 't2', name: 'Đại lý Vàng', minOrderVolume: 50_000_000, creditLimit: 0, paymentTerms: null };
const RATE_PREVIEW = {
  rows: [{ line: 1, sku: 'NRC-500', input: '10', status: 'OK', rate: 10, currentRate: null, productName: 'Nước rửa chén', variationName: '500ml', message: null }],
  counts: { OK: 1, UNCHANGED: 0, NOT_FOUND: 0, INVALID: 0, OVER_CAP: 0, DUPLICATE: 0 },
  blocking: 0,
  maxRate: 50,
  canApply: true,
};
const DEALER_PREVIEW = {
  tierId: 't1',
  rows: [{ line: 1, sku: 'NRC-500', input: '85.000', status: 'OK', price: 85_000, currentPrice: null, retailPrice: 100_000, productName: 'Nước rửa chén', variationName: '500ml', message: null }],
  counts: { OK: 1, UNCHANGED: 0, NOT_FOUND: 0, INVALID: 0, OUT_OF_RANGE: 0, DUPLICATE: 0 },
  blocking: 0,
  canApply: true,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let listGate: Promise<void> | undefined;
let writeGate: Promise<void> | undefined;
let listLoads = 0;
let historyLoads = 0;
let historyGate: Promise<void> | undefined;
let previewGate: Promise<void> | undefined;
let writeStatus = 200;
const writes: { method: string; url: string }[] = [];
const count = (suffix: string) => writes.filter((w) => w.url.endsWith(suffix)).length;

const writeBody = (url: string) => {
  if (url.endsWith('/fill-missing')) return { updated: 2, affiliateRate: 10 };
  if (url.includes('/products/')) return { productId: 'p1', updated: 2, affiliateRate: 10 };
  if (url.endsWith('/import/apply')) return { updated: 1, unchanged: 0, notFound: [] };
  return { updated: 1, unchanged: 0, skipped: 0, notFound: [] };
};

let mounted: Rendered | null = null;
beforeEach(() => {
  listGate = undefined;
  writeGate = undefined;
  listLoads = 0;
  historyLoads = 0;
  historyGate = undefined;
  previewGate = undefined;
  writeStatus = 200;
  writes.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/admin/dealer-tiers')) return json(200, [TIER, TIER2]);
      if (url.endsWith('/admin/commission-rates/import/preview')) return json(200, RATE_PREVIEW);
      if (url.endsWith('/admin/dealer-prices/import/preview')) {
        await previewGate;
        return json(200, DEALER_PREVIEW);
      }
      if (method !== 'GET') {
        writes.push({ method, url });
        await writeGate;
        if (writeStatus !== 200) return json(writeStatus, { statusCode: writeStatus, message: `Lỗi ${writeStatus} từ máy chủ` });
        return json(200, writeBody(url));
      }
      if (url.includes('/admin/history-probe')) {
        historyLoads += 1;
        if (historyLoads > 1) await historyGate;
        return json(200, []);
      }
      if (url.includes('/admin/commission-rates?')) {
        listLoads += 1;
        if (listLoads > 1) await listGate;
        return json(200, PAGE);
      }
      return json(500, { message: `no mock for ${url}` });
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<CommissionRatesTab />);
  await flush();
  return mounted.container;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};
const pasteCsv = async (section: HTMLElement, label: string, previewLabel: RegExp, csv: string) => {
  typeInto(section.querySelector(`textarea[aria-label="${label}"]`), csv);
  click(byText(section, 'button', previewLabel));
  await flush();
};

interface Form {
  name: string;
  /** Chuẩn bị tới lúc bấm được nút ghi; trả về hàm tìm nút ghi và ô nhập đang bị khoá khi gửi. */
  open: (c: HTMLElement) => Promise<{ btn: () => HTMLButtonElement; field: () => HTMLInputElement | HTMLTextAreaElement }>;
  writeSuffix: string;
  /** Sau khi ghi thành công nút ghi còn hiện (ô % được xoá, nút disabled vì trống) hay biến mất cùng bản xem trước. */
  buttonSurvivesSuccess: boolean;
}

const fillSection = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="% áp cho biến thể chưa có %"]')!.closest<HTMLElement>('.rounded-card')!;
const forms: Form[] = [
  {
    name: 'Áp % cho biến thể chưa có %',
    writeSuffix: '/fill-missing',
    buttonSurvivesSuccess: true,
    open: async (c) => {
      typeInto(fillSection(c).querySelector('input'), '10');
      return {
        btn: () => byText(fillSection(c), 'button', /^Áp dụng$|^Đang áp…$/) as HTMLButtonElement,
        field: () => fillSection(c).querySelector('input')!,
      };
    },
  },
  {
    name: 'Đặt % cho cả sản phẩm',
    writeSuffix: '/products/p1',
    buttonSurvivesSuccess: true,
    open: async (c) => {
      const card = () => c.querySelector<HTMLElement>('[data-commission-product]')!;
      typeInto(card().querySelector('input[aria-label^="% cho mọi biến thể đang bán"]'), '10');
      return {
        btn: () => byText(card(), 'button', /^Đặt cho cả SP$|^Đang đặt…$/) as HTMLButtonElement,
        field: () => card().querySelector<HTMLInputElement>('input[aria-label^="% cho mọi biến thể đang bán"]')!,
      };
    },
  },
  {
    name: 'Nhập CSV %',
    writeSuffix: '/import/apply',
    buttonSurvivesSuccess: false,
    open: async (c) => {
      const section = () => c.querySelector<HTMLElement>('section[aria-label="Nhập % hoa hồng từ CSV"]')!;
      await pasteCsv(section(), 'Nội dung CSV sku,% hoa hồng', /^Xem trước$/, 'NRC-500,10');
      return {
        btn: () => byText(section(), 'button', /^Áp dụng 1 dòng$|^Đang áp…$/) as HTMLButtonElement,
        field: () => section().querySelector('textarea')!,
      };
    },
  },
  {
    name: 'Nhập CSV giá sỉ',
    writeSuffix: '/dealer-prices/import',
    buttonSurvivesSuccess: false,
    open: async (c) => {
      const section = () => c.querySelector<HTMLElement>('section[aria-label="Giá sỉ đại lý"]')!;
      typeInto(section().querySelector('select'), 't1');
      await pasteCsv(section(), 'Nội dung CSV sku,giá sỉ', /^Xem trước giá sỉ$/, 'NRC-500;85.000');
      return {
        btn: () => byText(section(), 'button', /^Ghi 1 giá sỉ$|^Đang ghi…$/) as HTMLButtonElement,
        field: () => section().querySelector('textarea')!,
      };
    },
  },
];

/** Bấm nút ghi, trả lời hộp xác nhận đồng ý, chờ lệnh và các lần tải lại chạy tới chỗ đang chặn. */
const submit = async (btn: () => HTMLButtonElement) => {
  click(btn());
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe.each(forms)('$name', (form) => {
  it('lệnh còn bay: nút aria-busy/aria-disabled (không disabled), ô nhập chỉ readOnly (không disabled)', async () => {
    const c = await mount();
    const { btn, field } = await form.open(c);
    const post = gate();
    writeGate = post.promise;
    await submit(btn);
    expect(count(form.writeSuffix)).toBe(1);
    expect(btn().getAttribute('aria-busy')).toBe('true');
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().disabled).toBe(false);
    expect(field().disabled).toBe(false);
    expect(field().readOnly).toBe(true);
    await tap(btn());
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count(form.writeSuffix)).toBe(1);
    post.resolve();
    await flush();
  });

  it('bị từ chối vì dữ liệu đã đổi (409): lỗi hiện ngay, danh sách tải lại, chạm lại trong khoá không mở hộp hỏi và không gửi lệnh thứ hai; danh sách về rồi mới nhả', async () => {
    writeStatus = 409;
    const c = await mount();
    const { btn } = await form.open(c);
    const list = gate();
    listGate = list.promise;
    await submit(btn);
    expect(listLoads).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 409');
    expect(btn().getAttribute('aria-busy')).toBe('true');
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().disabled).toBe(false);
    await tap(btn());
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count(form.writeSuffix)).toBe(1);
    list.resolve();
    await flush();
    expect(btn().getAttribute('aria-disabled')).toBeNull();
    expect(btn().getAttribute('aria-busy')).toBeNull();
  });

  it('lỗi 400 (lỗi nhập liệu: số % ngoài khoảng, CSV có dòng lỗi): lỗi hiện ngay tại form, KHÔNG tải lại danh sách, nhả khoá ngay', async () => {
    writeStatus = 400;
    const c = await mount();
    const { btn, field } = await form.open(c);
    const list = gate();
    listGate = list.promise;
    await submit(btn);
    expect(count(form.writeSuffix)).toBe(1);
    expect(listLoads).toBe(1);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 400');
    expect(btn().getAttribute('aria-disabled')).toBeNull();
    expect(btn().getAttribute('aria-busy')).toBeNull();
    expect(field().readOnly).toBe(false);
    list.resolve();
    await flush();
  });

  it('lỗi 404 (mục không còn): tải lại danh sách, giữ khoá tới khi danh sách về', async () => {
    writeStatus = 404;
    const c = await mount();
    const { btn } = await form.open(c);
    const list = gate();
    listGate = list.promise;
    await submit(btn);
    expect(listLoads).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 404');
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn().getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500: hiện lỗi, lệnh không tự tải lại danh sách (QueryClient trần, không có MutationCache như production), nhả khoá ngay', async () => {
    writeStatus = 500;
    const c = await mount();
    const { btn } = await form.open(c);
    await submit(btn);
    expect(listLoads).toBe(1);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 500');
    expect(btn().getAttribute('aria-disabled')).toBeNull();
    expect(btn().getAttribute('aria-busy')).toBeNull();
  });

  it('xong mà danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    const { btn, field } = await form.open(c);
    listGate = new Promise<void>(() => {});
    await submit(btn);
    expect(count(form.writeSuffix)).toBe(1);
    // nút ghi còn (ô % trống nên disabled thật) hoặc đã biến mất cùng bản xem trước: ô nhập là chỗ thấy được khoá
    const held = () => (form.buttonSurvivesSuccess ? btn().getAttribute('aria-disabled') : field().getAttribute('aria-busy'));
    await advance(3_500);
    expect(held()).toBe('true');
    await advance(700);
    expect(held()).toBeNull();
  });

  it('xong mà danh sách chưa về: ô nhập vẫn chỉ readOnly (không disabled) tới khi danh sách về, rồi mở lại', async () => {
    const c = await mount();
    const { btn, field } = await form.open(c);
    const list = gate();
    listGate = list.promise;
    await submit(btn);
    expect(listLoads).toBe(2);
    expect(field().disabled).toBe(false);
    expect(field().readOnly).toBe(true);
    list.resolve();
    await flush();
    expect(field().readOnly).toBe(false);
  });
});

describe('Giá sỉ đại lý: ô chọn bậc khoá khi xem trước hoặc ghi còn chạy', () => {
  const section = (c: HTMLElement) => c.querySelector<HTMLElement>('section[aria-label="Giá sỉ đại lý"]')!;
  const tierSelect = (c: HTMLElement) => section(c).querySelector('select')!;
  const csvBox = (c: HTMLElement) => section(c).querySelector('textarea[aria-label="Nội dung CSV sku,giá sỉ"]')!;

  it('ghi còn bay: đổi sang bậc khác bị chặn (ô vẫn ở bậc đã xem trước) nên lời "Đã cập nhật" không đứng cạnh bậc khác; ghi xong thì đổi bậc được lại', async () => {
    const c = await mount();
    const { btn } = await forms[3]!.open(c);
    const post = gate();
    writeGate = post.promise;
    await submit(btn);
    expect(count('/dealer-prices/import')).toBe(1);
    expect(tierSelect(c).matches(':disabled')).toBe(true);
    typeInto(tierSelect(c), 't2');
    await flush(1);
    expect(tierSelect(c).value).toBe('t1');
    expect(btn().getAttribute('aria-busy')).toBe('true');
    post.resolve();
    await flush();
    expect(section(c).querySelector('[role="status"]')?.textContent).toContain('Đã cập nhật 1 giá sỉ');
    expect(tierSelect(c).value).toBe('t1');
    expect(tierSelect(c).matches(':disabled')).toBe(false);
    typeInto(tierSelect(c), 't2');
    await flush(1);
    expect(tierSelect(c).value).toBe('t2');
  });

  it('xem trước còn bay: đổi bậc bị chặn, bản xem trước về vẫn thuộc đúng bậc đang chọn', async () => {
    const c = await mount();
    typeInto(tierSelect(c), 't1');
    const pre = gate();
    previewGate = pre.promise;
    typeInto(csvBox(c), 'NRC-500;85.000');
    click(byText(section(c), 'button', /^Xem trước giá sỉ$/));
    await flush(2);
    expect(tierSelect(c).matches(':disabled')).toBe(true);
    typeInto(tierSelect(c), 't2');
    await flush(1);
    expect(tierSelect(c).value).toBe('t1');
    pre.resolve();
    await flush();
    expect(byText(section(c), 'button', /^Ghi 1 giá sỉ$/)).not.toBeNull();
    expect(tierSelect(c).value).toBe('t1');
    expect(tierSelect(c).matches(':disabled')).toBe(false);
  });

  it('lệnh ghi bị từ chối: ô chọn bậc mở lại ngay (không kẹt khoá)', async () => {
    writeStatus = 400;
    const c = await mount();
    const { btn } = await forms[3]!.open(c);
    await submit(btn);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 400');
    typeInto(tierSelect(c), 't2');
    await flush(1);
    expect(tierSelect(c).value).toBe('t2');
  });
});

describe('số dùng tabular-nums', () => {
  it('lời báo kết quả áp % cho biến thể chưa có % và đặt % cho cả sản phẩm', async () => {
    const c = await mount();
    const fill = await forms[0]!.open(c);
    await submit(fill.btn);
    const fillMsg = fillSection(c).querySelector<HTMLElement>('[role="status"]')!;
    expect(fillMsg.textContent).toContain('Đã đặt');
    expect(fillMsg.className).toContain('tabular-nums');
    const product = await forms[1]!.open(c);
    await submit(product.btn);
    const productMsg = c.querySelector<HTMLElement>('[data-commission-product] [role="status"]')!;
    expect(productMsg.textContent).toContain('Đã đặt');
    expect(productMsg.className).toContain('tabular-nums');
  });
});

/** Lịch sử giá đại lý đang mở ở nơi khác trong trang: nhập giá sỉ xong phải làm mới nó và khoá chờ nó về. */
function WithPriceHistory() {
  useQuery({ queryKey: ['admin-dealer-price-history'], queryFn: async () => (await fetch('/admin/history-probe')).json() as Promise<unknown> });
  return <CommissionRatesTab />;
}

describe('Nhập CSV giá sỉ làm mới lịch sử giá đại lý', () => {
  it('xong thì lịch sử giá đang mở được tải lại, ô CSV còn aria-busy tới khi lịch sử về', async () => {
    mounted = render(<WithPriceHistory />);
    await flush();
    const c = mounted.container;
    const { btn, field } = await forms[3]!.open(c);
    const hist = gate();
    historyGate = hist.promise;
    await submit(btn);
    expect(count('/dealer-prices/import')).toBe(1);
    expect(historyLoads).toBe(2);
    expect(field().getAttribute('aria-busy')).toBe('true');
    hist.resolve();
    await flush();
    expect(field().getAttribute('aria-busy')).toBeNull();
  });
});

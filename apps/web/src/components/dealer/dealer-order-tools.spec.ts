import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@tubutree/shared-types';
import {
  CREDIT_LEDGER_CSV_HEADERS,
  DEALER_ORDER_PLACED_KEYS,
  DEALER_ORDER_REFRESH_KEYS,
  applyReorderRequest,
  canReorder,
  creditAfterText,
  dealerCreditLedgerCsv,
  dealerCreditLedgerFileName,
  filterDealerOrders,
  lastMonthReorderLabel,
  reorderLinesOf,
  reorderNotice,
  reorderQuantities,
} from './dealer-order-tools';

const item = (over: Record<string, unknown> = {}) => ({ variationId: 'v1', quantity: 2, productName: 'Nước rửa chén', variationName: '500ml', ...over });

describe('filterDealerOrders', () => {
  const orders = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'RETURNED'].map((status, i) => ({ code: `T${i}`, status: status as OrderStatus }));
  it('Tất cả giữ mọi đơn; Chờ thanh toán; Đang giao gom đã xác nhận/đóng gói/đang giao; Đã giao; huỷ và hoàn chỉ ở Tất cả', () => {
    const codes = (f: Parameters<typeof filterDealerOrders>[1]) => filterDealerOrders(orders, f).map((o) => o.code);
    expect(codes('all')).toHaveLength(7);
    expect(codes('pending')).toEqual(['T0']);
    expect(codes('shipping')).toEqual(['T1', 'T2', 'T3']);
    expect(codes('delivered')).toEqual(['T4']);
  });
});

describe('Đặt lại đơn sỉ', () => {
  it('reorderLinesOf: bỏ quà 0đ, dòng thiếu mã phân loại, số lượng 0/âm/lẻ; tên gồm sản phẩm và phân loại', () => {
    const lines = reorderLinesOf({
      items: [item(), item({ variationId: '', quantity: 1 }), item({ variationId: 'v2', isGift: true }), item({ variationId: 'v3', quantity: 0 }), item({ variationId: 'v4', quantity: 1.5 }), item({ variationId: 'v5', variationName: '' })],
    });
    expect(lines).toEqual([
      { variationId: 'v1', quantity: 2, name: 'Nước rửa chén – 500ml' },
      { variationId: 'v5', quantity: 2, name: 'Nước rửa chén' },
    ]);
  });

  it('canReorder: đơn chờ thanh toán không có nút (thẻ đã có Thanh toán ngay); đơn không còn dòng hàng nào cũng không', () => {
    expect(canReorder({ status: 'DELIVERED', items: [item()] })).toBe(true);
    expect(canReorder({ status: 'CANCELLED', items: [item()] })).toBe(true);
    expect(canReorder({ status: 'PENDING_PAYMENT', items: [item()] })).toBe(false);
    expect(canReorder({ status: 'DELIVERED', items: [item({ isGift: true })] })).toBe(false);
    expect(canReorder({ status: 'DELIVERED', items: undefined })).toBe(false);
  });

  it('reorderQuantities: bỏ phân loại ngừng bán sỉ (nêu tên một lần), cộng hai dòng cùng phân loại, kẹp 9999', () => {
    const r = reorderQuantities(
      [
        { variationId: 'v1', quantity: 3, name: 'A – 1L' },
        { variationId: 'v1', quantity: 4, name: 'A – 1L' },
        { variationId: 'gone', quantity: 2, name: 'B – 5L' },
        { variationId: 'gone', quantity: 1, name: 'B – 5L' },
        { variationId: 'v2', quantity: 9000, name: 'C' },
        { variationId: 'v2', quantity: 9000, name: 'C' },
      ],
      [{ variationId: 'v1' }, { variationId: 'v2' }],
    );
    expect(r).toEqual({ qty: { v1: 7, v2: 9999 }, added: 2, skipped: ['B – 5L'] });
  });

  it('reorderNotice: đủ món thì báo thường; thiếu món thì báo lỗi kèm tên; không còn món nào thì nói giỏ chưa đổi', () => {
    expect(reorderNotice('TUBU9', { added: 2, skipped: [] })).toEqual({ text: 'Đã nạp 2 mặt hàng của đơn #TUBU9 theo giá hôm nay, kiểm tra số lượng rồi đặt.', error: false });
    const partial = reorderNotice('TUBU9', { added: 1, skipped: ['B – 5L', 'C'] });
    expect(partial.error).toBe(true);
    expect(partial.text).toContain('Bỏ qua 2 mặt hàng không còn bán sỉ: B – 5L, C.');
    const none = reorderNotice('TUBU9', { added: 0, skipped: ['B – 5L'] });
    expect(none).toEqual({ text: 'Đơn #TUBU9 không còn mặt hàng nào đang bán sỉ, giỏ chưa đổi. Bỏ qua 1 mặt hàng không còn bán sỉ: B – 5L.', error: true });
  });
});

describe('dealerCreditLedgerCsv', () => {
  const at = (iso: string) => `T(${iso.slice(0, 10)})`;
  const entry = (over: Record<string, unknown>) => ({ id: 'e', delta: 0, note: null, refType: 'ORDER', createdAt: '2026-11-20T00:00:00.000Z', ...over }) as never;

  it('BOM UTF-8, CRLF, tiêu đề tiếng Việt; dư nợ sau giao dịch tính lùi từ dư nợ hiện tại; số âm vẫn là số', () => {
    const csv = dealerCreditLedgerCsv(
      [entry({ delta: -300_000, note: null, refType: 'PAYMENT', createdAt: '2026-11-21T00:00:00.000Z' }), entry({ delta: 500_000, note: 'Đơn TUBU1' })],
      1_200_000,
      at,
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    const rows = csv.slice(1).trimEnd().split('\r\n');
    expect(rows[0]).toBe(CREDIT_LEDGER_CSV_HEADERS.map((h) => `"${h}"`).join(','));
    expect(rows[1]).toBe('"T(2026-11-21)","PAYMENT","PAYMENT",-300000,1200000');
    expect(rows[2]).toBe('"T(2026-11-20)","Đơn TUBU1","ORDER",500000,1500000');
  });

  it('chống chèn công thức: ô chữ mở đầu bằng = + - @ tab CR có nháy đơn, ngoặc kép được nhân đôi, ô số hỏng để trống', () => {
    const notes = ['=HYPERLINK("http://x","bấm")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', 'Đơn "VIP"'];
    const csv = dealerCreditLedgerCsv(
      notes.map((note, i) => entry({ id: `e${i}`, note, delta: Number.NaN })),
      0,
      () => '=cmd|calc',
    );
    const body = csv.slice(1);
    expect(body).toContain(`"'=HYPERLINK(""http://x"",""bấm"")"`);
    expect(body).toContain(`"'+1+1"`);
    expect(body).toContain(`"'-2+3"`);
    expect(body).toContain(`"'@SUM(A1)"`);
    expect(body).toContain(`"'\t=1"`);
    expect(body).toContain(`"'\n=1"`);
    expect(body).toContain(`"Đơn ""VIP"""`);
    expect(body).toContain(`"'=cmd|calc"`);
    // Ô số hỏng (NaN) để trống; dư nợ sau giao dịch không bị NaN kéo theo.
    expect(body.trimEnd().split('\r\n')[1]).toMatch(/,,0$/);
  });

  it('tên tệp theo ngày', () => {
    expect(dealerCreditLedgerFileName('2026-11-23')).toBe('so-cong-no-dai-ly-tubu-2026-11-23.csv');
  });
});

describe('Đặt lại đơn tháng trước', () => {
  it('nhãn nút lấy số tháng của bản xem trước', () => {
    expect(lastMonthReorderLabel('10/2026')).toBe('Đặt lại đơn tháng 10');
    expect(lastMonthReorderLabel('12/2026')).toBe('Đặt lại đơn tháng 12');
  });

  it('reorderNotice nhận nhãn thay "đơn #mã"; viết hoa chữ đầu khi đứng đầu câu', () => {
    expect(reorderNotice('DL-2', { added: 2, skipped: [] }, 'đơn tháng 10/2026').text).toBe(
      'Đã nạp 2 mặt hàng của đơn tháng 10/2026 theo giá hôm nay, kiểm tra số lượng rồi đặt.',
    );
    expect(reorderNotice('DL-2', { added: 0, skipped: ['A'] }, 'đơn tháng 10/2026').text).toBe(
      'Đơn tháng 10/2026 không còn mặt hàng nào đang bán sỉ, giỏ chưa đổi. Bỏ qua 1 mặt hàng không còn bán sỉ: A.',
    );
  });

  it('applyReorderRequest gộp tên máy chủ đã bỏ với tên bảng giá không còn, mỗi tên một lần', () => {
    const res = applyReorderRequest(
      {
        code: 'DL-2',
        label: 'đơn tháng 10/2026',
        lines: [
          { variationId: 'v1', quantity: 3, name: 'A' },
          { variationId: 'gone', quantity: 1, name: 'B' },
        ],
        skipped: ['C', 'B'],
      },
      [{ variationId: 'v1' }],
    );
    expect(res.qty).toEqual({ v1: 3 });
    expect(res.notice).toEqual({
      text: 'Đã nạp 1 mặt hàng của đơn tháng 10/2026 theo giá hôm nay, kiểm tra số lượng rồi đặt. Bỏ qua 2 mặt hàng không còn bán sỉ: C, B.',
      error: true,
    });
  });

  it('hạn mức sau đơn: âm thì ghi phần vượt', () => {
    const money = (n: number) => `${n}đ`;
    expect(creditAfterText(6_080_000, money)).toBe('6080000đ');
    expect(creditAfterText(0, money)).toBe('0đ');
    expect(creditAfterText(-920_000, money)).toBe('Vượt 920000đ');
  });

  it('đặt đơn (thường hay đặt lại) xong và bị từ chối đều tải lại bản xem trước của đơn tháng trước', () => {
    expect(DEALER_ORDER_PLACED_KEYS).toContain('dealer-last-month-reorder');
    expect(DEALER_ORDER_REFRESH_KEYS).toContain('dealer-last-month-reorder');
    expect(DEALER_ORDER_REFRESH_KEYS).toContain('dealer-pricelist');
  });
});

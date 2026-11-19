import { describe, expect, it } from 'vitest';
import type { WastePublicFlags, WastePublicWarehouseDTO } from '@tubutree/shared-types';
import { wasteFaq } from './waste-faq';

const PROD_FLAGS: WastePublicFlags = { enabled: true, dropoff: true, mailin: false, pickup: true };
const HCM: WastePublicWarehouseDTO = {
  name: 'Kho Tubu',
  provinceName: 'TP. Hồ Chí Minh',
  openingHours: Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => [d, [{ open: '08:30', close: '17:30' }]])),
};
const items = [
  { name: 'Vỏ chai nhựa', status: 'ACTIVE' as const, sortOrder: 2 },
  { name: 'Hộp giấy', status: 'ACTIVE' as const, sortOrder: 1 },
  { name: 'Pin cũ', status: 'COMING_SOON' as const, sortOrder: 3 },
  { name: 'Ẩn', status: 'HIDDEN' as const, sortOrder: 0 },
];
const text = (faq: { q: string; a: string }[]) => faq.map((f) => `${f.q} ${f.a}`).join('\n');

describe('wasteFaq (FAQ trang Đổi rác, dựng từ dữ liệu thật)', () => {
  it('cấu hình PROD (mang tới kho + thu kèm đơn, gửi kho tắt): giờ kho thật T2–T7 08:30–17:30, không nhắc đường gửi kho', () => {
    const faq = wasteFaq({ flags: PROD_FLAGS, warehouses: [HCM], items });
    expect(faq.map((f) => f.q)).toEqual([
      'Đổi vỏ chai, bao bì lấy Điểm Xanh ở Tubu Tree thế nào?',
      'Tubu Tree nhận đổi những món nào?',
      'Kho Tubu nhận vỏ chai, bao bì vào giờ nào?',
      'Người giao hàng có thu vỏ chai, bao bì kèm đơn không?',
      'Cần chuẩn bị vỏ chai, bao bì thế nào?',
      'Khi nào được cộng Điểm Xanh và dùng điểm vào việc gì?',
    ]);
    expect(faq[0]!.a).toContain('chọn cách giao: mang tới kho Tubu hoặc gửi người giao hàng khi nhận đơn Tubu.');
    expect(faq[2]!.a).toContain('Kho Tubu (TP. Hồ Chí Minh) mở cửa nhận rác T2–T7 08:30–17:30.');
    expect(faq[2]!.a).toContain('địa chỉ kho hiện khi bạn chọn điểm nhận');
    expect(faq[3]!.a).toContain('“Thu kèm đơn mua”');
    // Luật thu kèm đơn chỉ chặn món nguy hại ngoài TP.HCM (waste-pickup-rules.ts), nên không được nói chung là "một số món chỉ nhận tận nơi".
    expect(faq[3]!.a).not.toMatch(/chỉ nhận khi mang/);
    const all = text(faq);
    expect(all).not.toMatch(/tự gửi|bưu điện|hãng vận chuyển|phí ship/i);
  });

  it('chỉ món ACTIVE, theo sortOrder, bỏ trùng; món Sắp nhận và món ẩn không được nêu', () => {
    const faq = wasteFaq({ flags: PROD_FLAGS, warehouses: [HCM], items: [...items, { name: ' Hộp giấy ', status: 'ACTIVE', sortOrder: 9 }] });
    expect(faq[1]!.a).toBe('Tubu đang nhận: Hộp giấy, Vỏ chai nhựa. Mức điểm của từng món hiện ngay trên trang Đổi rác.');
    expect(text(faq)).not.toMatch(/Pin cũ|Ẩn/);
  });

  it('quá 12 món thì nêu 12 món đầu và "một số món khác"; danh mục rỗng hoặc chưa tải được thì bỏ câu đó', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `Món ${i + 1}`, status: 'ACTIVE' as const, sortOrder: i }));
    const a = wasteFaq({ flags: PROD_FLAGS, warehouses: [HCM], items: many })[1]!.a;
    expect(a).toContain('Món 12 và một số món khác.');
    expect(a).not.toContain('Món 13');
    expect(wasteFaq({ flags: PROD_FLAGS, warehouses: [HCM] }).map((f) => f.q)).not.toContain('Tubu Tree nhận đổi những món nào?');
    expect(wasteFaq({ flags: PROD_FLAGS, warehouses: [HCM], items: [] }).map((f) => f.q)).not.toContain('Tubu Tree nhận đổi những món nào?');
  });

  it('chương trình tắt: không có câu nào (trang không khai FAQPage)', () => {
    expect(wasteFaq({ flags: { enabled: false, dropoff: true, mailin: true, pickup: true }, warehouses: [HCM], items })).toEqual([]);
  });

  it('thu kèm đơn tắt: không câu người giao hàng, câu đầu chỉ nêu mang tới kho', () => {
    const faq = wasteFaq({ flags: { ...PROD_FLAGS, pickup: false }, warehouses: [HCM], items });
    expect(faq[0]!.a).toContain('chọn cách giao: mang tới kho Tubu.');
    expect(text(faq)).not.toMatch(/người giao|tài xế|bưu tá|Thu kèm đơn/);
  });

  it('mang tới tắt: không câu giờ kho dù API vẫn trả kho', () => {
    const faq = wasteFaq({ flags: { ...PROD_FLAGS, dropoff: false }, warehouses: [HCM], items });
    expect(text(faq)).not.toMatch(/08:30|mang tới kho|điểm nhận thế nào/);
    expect(faq[0]!.a).toContain('chọn cách giao: gửi người giao hàng khi nhận đơn Tubu.');
  });

  it('mang tới bật nhưng chưa có kho (API cũ hay chưa cấu hình): câu chung về điểm nhận, không bịa giờ', () => {
    const faq = wasteFaq({ flags: PROD_FLAGS, warehouses: [], items });
    expect(faq.map((f) => f.q)).toContain('Mang vỏ chai, bao bì tới điểm nhận thế nào?');
    expect(text(faq)).not.toMatch(/\d{2}:\d{2}/);
    expect(faq[0]!.a).toContain('mang tới điểm nhận hoặc gửi người giao hàng khi nhận đơn Tubu');
  });

  it('kho chưa có giờ mở cửa: không nêu giờ; tên kho đã chứa tỉnh thì không lặp tỉnh; nhiều khung giờ gộp bằng dấu chấm phẩy', () => {
    const noHours = wasteFaq({ flags: PROD_FLAGS, warehouses: [{ ...HCM, openingHours: {} }] })[1]!.a;
    expect(noHours).toContain('Kho Tubu (TP. Hồ Chí Minh) nhận rác; giờ mở cửa hiện khi bạn chọn điểm nhận lúc tạo yêu cầu.');
    expect(noHours).not.toMatch(/\d{2}:\d{2}/);
    const split = wasteFaq({
      flags: PROD_FLAGS,
      warehouses: [{ name: 'Kho TP. Hồ Chí Minh', provinceName: 'TP. Hồ Chí Minh', openingHours: { MON: [{ open: '08:30', close: '17:30' }], SAT: [{ open: '08:30', close: '12:00' }] } }],
    })[1]!.a;
    expect(split).toContain('Kho TP. Hồ Chí Minh mở cửa nhận rác T2 08:30–17:30; T7 08:30–12:00.');
  });

  it('gửi kho bật thì có câu tự gửi, không hứa miễn phí; không cách nào mở thì câu đầu không liệt kê cách giao', () => {
    const faq = wasteFaq({ flags: { enabled: true, dropoff: false, mailin: true, pickup: false }, warehouses: [] });
    expect(faq.map((f) => f.q)).toContain('Có tự gửi vỏ chai, bao bì về kho Tubu được không?');
    expect(faq.find((f) => f.q.startsWith('Có tự gửi'))!.a).not.toContain('miễn phí');
    const none = wasteFaq({ flags: { enabled: true, dropoff: false, mailin: false, pickup: false }, warehouses: [HCM] });
    expect(none[0]!.a).toContain('chọn cách giao đang mở khi tạo yêu cầu');
  });
});

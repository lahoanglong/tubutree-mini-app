// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGuestDraft, EMPTY_GUEST_DRAFT, readGuestDraft, saveGuestDraft } from './draft';

const KEY = 'tubu.guestCheckout.draft';
const GEO = { province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Cầu Giấy', wardCode: '84_VN01_001' };
const FULL = { name: 'Lan', phone: '0912345678', geo: GEO, street: '12 Ngõ 5', note: 'Gọi trước' };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('nháp biểu mẫu nhận hàng của khách (sessionStorage)', () => {
  it('lưu rồi đọc lại đủ 5 trường; chỉ ở sessionStorage, không ở localStorage; xoá thì về rỗng', () => {
    saveGuestDraft(FULL);
    expect(readGuestDraft()).toEqual(FULL);
    expect(localStorage.length).toBe(0);
    clearGuestDraft();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(readGuestDraft()).toEqual(EMPTY_GUEST_DRAFT);
  });

  it('biểu mẫu trống: xoá bản lưu thay vì ghi một nháp rỗng', () => {
    saveGuestDraft(FULL);
    saveGuestDraft(EMPTY_GUEST_DRAFT);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('chỉ ghi đúng 5 trường (trường lạ truyền vào không lọt vào bản lưu)', () => {
    saveGuestDraft({ ...FULL, paymentMethod: 'COD', trackingKey: 'x' } as typeof FULL);
    expect(Object.keys(JSON.parse(sessionStorage.getItem(KEY)!) as object).sort()).toEqual(['geo', 'name', 'note', 'phone', 'street']);
  });

  it('bản lưu hỏng hay sai kiểu: rỗng, không ném', () => {
    for (const raw of ['{', '[]', '"x"', 'null', JSON.stringify({ name: 1, phone: {}, geo: 'x', street: null })]) {
      sessionStorage.setItem(KEY, raw);
      expect(readGuestDraft()).toEqual(EMPTY_GUEST_DRAFT);
    }
  });

  it('tỉnh/phường thiếu nửa cặp tên–mã: bỏ cấp đó (phường không đứng một mình khi chưa có tỉnh)', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ ...FULL, geo: { ...GEO, wardCode: '' } }));
    expect(readGuestDraft().geo).toEqual({ ...GEO, ward: '', wardCode: '' });
    sessionStorage.setItem(KEY, JSON.stringify({ ...FULL, geo: { ...GEO, provinceCode: '' } }));
    expect(readGuestDraft().geo).toEqual(EMPTY_GUEST_DRAFT.geo);
  });

  it('cắt theo trần độ dài của từng ô', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ ...FULL, name: 'a'.repeat(500), note: 'n'.repeat(900), phone: '0'.repeat(40) }));
    const d = readGuestDraft();
    expect(d.name).toHaveLength(120);
    expect(d.note).toHaveLength(500);
    expect(d.phone).toHaveLength(20);
  });

  it('sessionStorage ném (chế độ riêng tư chặn): đọc rỗng, ghi và xoá không ném', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => saveGuestDraft(FULL)).not.toThrow();
    expect(() => clearGuestDraft()).not.toThrow();
    expect(readGuestDraft()).toEqual(EMPTY_GUEST_DRAFT);
  });
});

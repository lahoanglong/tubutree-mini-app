// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAX_RECENT_CUSTOMERS, loadRecentCustomers, recentCustomerLabel, saveRecentCustomer,
  type RecentCustomer,
} from './recent-customers';

const cust = (over: Partial<RecentCustomer> = {}): RecentCustomer => ({
  recipient: 'Nguyễn An', phone: '0901234567', street: '12 Lê Lợi',
  province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Phường Ba Đình', wardCode: '84_VN0101', usedAt: 1,
  ...over,
});

describe('recent-customers (C-064)', () => {
  beforeEach(() => localStorage.clear());

  it('rỗng khi chưa lưu, hoặc khi không biết tài khoản', () => {
    expect(loadRecentCustomers('u1')).toEqual([]);
    expect(loadRecentCustomers(undefined)).toEqual([]);
  });

  it('lưu rồi đọc lại, khách mới nhất đứng đầu', () => {
    saveRecentCustomer('u1', cust({ recipient: 'A', phone: '0900000001' }), 100);
    saveRecentCustomer('u1', cust({ recipient: 'B', phone: '0900000002' }), 200);
    expect(loadRecentCustomers('u1').map((c) => c.recipient)).toEqual(['B', 'A']);
  });

  it('cùng SĐT thì cập nhật bản ghi (địa chỉ mới) và đưa lên đầu, không nhân đôi', () => {
    saveRecentCustomer('u1', cust({ recipient: 'A', phone: '0900000001', street: 'cũ' }), 100);
    saveRecentCustomer('u1', cust({ recipient: 'B', phone: '0900000002' }), 200);
    saveRecentCustomer('u1', cust({ recipient: 'A', phone: '+84900000001', street: 'mới' }), 300);
    const list = loadRecentCustomers('u1');
    expect(list.map((c) => c.recipient)).toEqual(['A', 'B']);
    expect(list[0]!.street).toBe('mới');
  });

  it(`giữ tối đa ${MAX_RECENT_CUSTOMERS} khách, bỏ khách cũ nhất`, () => {
    for (let i = 0; i < MAX_RECENT_CUSTOMERS + 3; i++) {
      saveRecentCustomer('u1', cust({ recipient: `K${i}`, phone: `09000000${String(i).padStart(2, '0')}` }), i);
    }
    const list = loadRecentCustomers('u1');
    expect(list).toHaveLength(MAX_RECENT_CUSTOMERS);
    expect(list[0]!.recipient).toBe(`K${MAX_RECENT_CUSTOMERS + 2}`);
    expect(list.some((c) => c.recipient === 'K0')).toBe(false);
  });

  it('mỗi tài khoản CTV một danh sách riêng (máy dùng chung không lộ khách của nhau)', () => {
    saveRecentCustomer('u1', cust({ recipient: 'Của u1' }), 1);
    expect(loadRecentCustomers('u2')).toEqual([]);
  });

  it('không có userId thì không lưu', () => {
    saveRecentCustomer(undefined, cust(), 1);
    expect(localStorage.length).toBe(0);
  });

  it('dữ liệu hỏng hoặc sai hình dạng thì bỏ qua, không văng lỗi', () => {
    localStorage.setItem('tubu_ctv_recent_customers:u1', 'không phải json');
    expect(loadRecentCustomers('u1')).toEqual([]);
    localStorage.setItem(
      'tubu_ctv_recent_customers:u1',
      JSON.stringify([{ recipient: 'Thiếu trường' }, cust({ recipient: 'Hợp lệ' }), null, 5]),
    );
    expect(loadRecentCustomers('u1').map((c) => c.recipient)).toEqual(['Hợp lệ']);
  });

  it('localStorage ném lỗi (chế độ riêng tư/bị chặn): đọc ra rỗng, ghi không văng', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadRecentCustomers('u1')).toEqual([]);
    expect(() => saveRecentCustomer('u1', cust(), 1)).not.toThrow();
    spy.mockRestore();
    spySet.mockRestore();
  });

  it('nhãn chip: tên + 3 số cuối SĐT để phân biệt khách trùng tên', () => {
    expect(recentCustomerLabel(cust({ recipient: 'Nguyễn An', phone: '0901234567' }))).toBe('Nguyễn An · …567');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { UPLOADED_MAX, UPLOADED_TTL_MS, readUploaded, rememberUploaded } from './uploaded-store';

const KEY = 'tubu-wp-triage-uploaded-v1';
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('uploaded-store', () => {
  it('chưa ghi gì thì rỗng; ghi rồi đọc lại được, không trùng id', () => {
    expect(readUploaded(1000).size).toBe(0);
    rememberUploaded('p1', 1000);
    rememberUploaded('p2', 2000);
    rememberUploaded('p1', 3000);
    expect([...readUploaded(4000)].sort()).toEqual(['p1', 'p2']);
  });

  it('id quá hạn bị bỏ khi đọc và khi ghi thêm, để mẫu số không phình mãi', () => {
    rememberUploaded('cu', 1000);
    expect(readUploaded(1000 + UPLOADED_TTL_MS).has('cu')).toBe(true);
    expect(readUploaded(1001 + UPLOADED_TTL_MS).has('cu')).toBe(false);
    rememberUploaded('moi', 5000 + UPLOADED_TTL_MS);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ moi: 5000 + UPLOADED_TTL_MS });
  });

  it(`giữ tối đa ${UPLOADED_MAX} id, ưu tiên mới nhất`, () => {
    for (let i = 0; i < UPLOADED_MAX + 5; i++) rememberUploaded(`p${i}`, 1000 + i);
    const ids = readUploaded(1000 + UPLOADED_MAX + 10);
    expect(ids.size).toBe(UPLOADED_MAX);
    expect(ids.has(`p${UPLOADED_MAX + 4}`)).toBe(true);
    expect(ids.has('p0')).toBe(false);
  });

  it('dữ liệu hỏng (không phải JSON, mảng, giá trị lạ) bị bỏ qua, không ném lỗi', () => {
    window.localStorage.setItem(KEY, '{hỏng');
    expect(readUploaded(1000).size).toBe(0);
    window.localStorage.setItem(KEY, '["p1"]');
    expect(readUploaded(1000).size).toBe(0);
    window.localStorage.setItem(KEY, JSON.stringify({ ok: 900, sai: 'x', nan: null }));
    expect([...readUploaded(1000)]).toEqual(['ok']);
  });

  it('lưu trữ bị chặn (ném lỗi khi đọc hoặc ghi): đọc ra rỗng, ghi lặng lẽ bỏ qua, không làm vỡ trang', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readUploaded(1000).size).toBe(0);
    expect(() => rememberUploaded('p1', 1000)).not.toThrow();
  });
});

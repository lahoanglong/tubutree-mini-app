import { uniquePhone } from './helpers';

/** Phone là khoá duy nhất của users: sinh theo đồng hồ thì hai lần tạo trong cùng một mili giây đụng nhau (PG cục bộ trả lời dưới 1ms). */
describe('uniquePhone', () => {
  it('nghìn số liên tiếp khi đồng hồ đứng yên đều khác nhau và đúng dạng 0X + 8 chữ số', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const phones = Array.from({ length: 1000 }, () => uniquePhone());
      expect(new Set(phones).size).toBe(1000);
      for (const p of phones) expect(p).toMatch(/^09\d{8}$/);
    } finally {
      now.mockRestore();
    }
  });

  it('tiền tố đầu số đổi được và các đầu số không trùng nhau', () => {
    expect(uniquePhone('07')).toMatch(/^07\d{8}$/);
    expect(uniquePhone('08')).toMatch(/^08\d{8}$/);
  });
});

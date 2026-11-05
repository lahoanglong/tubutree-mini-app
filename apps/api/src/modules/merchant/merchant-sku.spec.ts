import { merchantSku } from './merchant-sku';

describe('merchantSku', () => {
  it('MCH-<mã thời gian base36 viết hoa>-<6 ký tự cuối của hậu tố viết hoa>', () => {
    expect(merchantSku('clx9abc123def', 1_800_000_000_000)).toBe(`MCH-${(1_800_000_000_000).toString(36).toUpperCase()}-123DEF`);
    expect(merchantSku('aabbcc', 1_800_000_000_000)).toBe(`MCH-${(1_800_000_000_000).toString(36).toUpperCase()}-AABBCC`);
  });
  it('hậu tố ngắn hơn 6 ký tự giữ nguyên, hai hậu tố khác nhau cho hai sku khác nhau cùng mili giây', () => {
    expect(merchantSku('ab', 1)).toBe('MCH-1-AB');
    expect(merchantSku('aabbcc', 5)).not.toBe(merchantSku('112233', 5));
  });
  it('mặc định lấy giờ hiện tại', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      expect(merchantSku('abcdef')).toBe(merchantSku('abcdef', 1_800_000_000_000));
    } finally {
      now.mockRestore();
    }
  });
});

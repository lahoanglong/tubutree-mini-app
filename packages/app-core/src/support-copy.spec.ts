import { describe, expect, it } from 'vitest';
import { quickReplies, supportCopy } from './support-copy';

describe('supportCopy.greeting', () => {
  it('có giờ trực thì nêu giờ trực của cấu hình', () => {
    expect(supportCopy.greeting('8:00–21:00 mỗi ngày')).toBe('Tubu Tree hỗ trợ 8:00–21:00 mỗi ngày. Bạn cần hỏi gì ạ?');
  });

  it('chưa có giờ trực thì không bịa giờ', () => {
    expect(supportCopy.greeting(null)).toBe('Tubu Tree sẵn sàng hỗ trợ bạn. Bạn cần hỏi gì ạ?');
  });
});

describe('quickReplies', () => {
  it('không có đơn đang giao: ba câu cố định', () => {
    expect(quickReplies(null).map((q) => q.label)).toEqual(['Đơn của tôi đang ở đâu?', 'Đổi trả hàng', 'Cách dùng sản phẩm']);
  });

  it('có đơn đang giao: thêm "Hỏi về đơn {mã}" lên đầu, câu gửi đi nêu mã đơn', () => {
    const list = quickReplies('TUBU123');
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({ label: 'Hỏi về đơn TUBU123', body: 'Mình muốn hỏi về đơn TUBU123.' });
  });

  it('mã đơn rỗng coi như không có đơn', () => {
    expect(quickReplies('  ')).toHaveLength(3);
  });
});

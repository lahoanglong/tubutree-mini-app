import { parseStaffReply } from './staff-reply-parse';

describe('parseStaffReply', () => {
  it('lấy mã đầu câu, chuẩn hoá chữ hoa, bỏ mã khỏi nội dung', () => {
    expect(parseStaffReply('#k7q2 Dạ đơn giao chiều nay')).toEqual({ code: 'K7Q2', body: 'Dạ đơn giao chiều nay' });
  });

  it('chỉ mã, không nội dung: body rỗng', () => {
    expect(parseStaffReply('#K7Q2')).toEqual({ code: 'K7Q2', body: '' });
  });

  it('năm ký tự sau # không phải mã', () => {
    expect(parseStaffReply('#K7Q22 abc')).toEqual({ code: null, body: '#K7Q22 abc' });
  });

  it('không mã hoặc null', () => {
    expect(parseStaffReply('Dạ vâng')).toEqual({ code: null, body: 'Dạ vâng' });
    expect(parseStaffReply(null)).toEqual({ code: null, body: '' });
  });
});

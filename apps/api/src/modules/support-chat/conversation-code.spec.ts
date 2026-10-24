import { CONVERSATION_CODE_ALPHABET, issueConversationCode, newConversationCode } from './conversation-code';

const seq = (...words: string[]) => {
  const vals = words.join('').split('').map((ch) => (CONVERSATION_CODE_ALPHABET.indexOf(ch) + 0.5) / CONVERSATION_CODE_ALPHABET.length);
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe('newConversationCode', () => {
  it('trả 4 ký tự đúng bảng chữ', () => {
    expect(newConversationCode(seq('K7Q2'))).toBe('K7Q2');
  });

  it.each(['TEST', 'SALE', 'FREE', 'HELP', 'NHAN', 'HANG'])('không bao giờ cấp %s, nhân viên có thể gõ #%s như thẻ', (word) => {
    expect(newConversationCode(seq(word, 'K7Q2'))).toBe('K7Q2');
  });
});

describe('issueConversationCode', () => {
  const db = (taken: string[], retired: string[]) => ({
    supportConversation: { findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(taken.includes(where.code) ? { id: 'x' } : null)) },
    supportRetiredCode: { findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(retired.includes(where.code) ? { code: where.code } : null)) },
  });

  it('mã chưa ai dùng thì cấp luôn', async () => {
    expect(await issueConversationCode(db([], []) as any, seq('K7Q2'))).toBe('K7Q2');
  });

  it('bỏ qua mã đang có hội thoại và mã đã nghỉ của khách xoá tài khoản', async () => {
    expect(await issueConversationCode(db(['K7Q2'], ['M4N5']) as any, seq('K7Q2', 'M4N5', 'R8S9'))).toBe('R8S9');
  });

  it('kiểm bảng hội thoại trước, rồi mới tới bảng mã nghỉ, tuần tự', async () => {
    const order: string[] = [];
    const d = {
      supportConversation: { findUnique: jest.fn().mockImplementation(async () => { order.push('conversation:start'); await Promise.resolve(); order.push('conversation:end'); return null; }) },
      supportRetiredCode: { findUnique: jest.fn().mockImplementation(async () => { order.push('retired'); return null; }) },
    };
    await issueConversationCode(d as any, seq('K7Q2'));
    expect(order).toEqual(['conversation:start', 'conversation:end', 'retired']);
  });
});

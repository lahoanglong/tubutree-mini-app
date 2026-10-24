import { CONVERSATION_CODE_ALPHABET, newConversationCode } from './conversation-code';

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

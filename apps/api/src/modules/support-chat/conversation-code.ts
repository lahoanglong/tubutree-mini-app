/** Bỏ 0 O 1 I để nhân viên gõ tay trong nhóm Zalo không nhầm. */
export const CONVERSATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CONVERSATION_CODE_ALPHABET[Math.min(CONVERSATION_CODE_ALPHABET.length - 1, Math.floor(random() * CONVERSATION_CODE_ALPHABET.length))];
  }
  return code;
}

export function newConversationCode(random: () => number = Math.random): string {
  let code = randomCode(random);
  while (BANNED_CODES.has(code)) code = randomCode(random);
  return code;
}

/** Từ thông dụng nhân viên hay gõ làm thẻ (#test, #sale...): mã trùng nó sẽ nhận nhầm tin trả lời không dành cho khách nào. */
const BANNED_CODES = new Set(['TEST', 'SALE', 'SHIP', 'FREE', 'HELP', 'INFO', 'CODE', 'NOTE', 'DONE', 'GIAO', 'NHAN', 'HANG', 'SHOP', 'ZALO']);

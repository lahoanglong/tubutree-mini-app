/** Bỏ 0 O 1 I để nhân viên gõ tay trong nhóm Zalo không nhầm. */
export const CONVERSATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newConversationCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CONVERSATION_CODE_ALPHABET[Math.min(CONVERSATION_CODE_ALPHABET.length - 1, Math.floor(random() * CONVERSATION_CODE_ALPHABET.length))];
  }
  return code;
}

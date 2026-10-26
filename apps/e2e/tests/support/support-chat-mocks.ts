import type { SupportChatMessageDTO, SupportChatSendInput, SupportChatThreadDTO } from '@tubutree/shared-types';
import { publicConfig, type MockApi } from './mock-api';

export const CHAT_ENABLED_CONFIG = {
  ...publicConfig(),
  support: { hotline: '0984606774', email: null, zaloOaName: null },
  chat: { enabled: true, hours: { start: '08:00', end: '21:00' } },
};

const msg = (over: Partial<SupportChatMessageDTO> & Pick<SupportChatMessageDTO, 'id' | 'sender' | 'body' | 'createdAt'>): SupportChatMessageDTO => ({
  imageUrl: null,
  context: null,
  clientMsgId: null,
  ...over,
});

export const GREETING = msg({
  id: 'sm-1',
  sender: 'STAFF',
  body: 'Chào bạn, Tubu Tree có thể giúp gì cho bạn?',
  createdAt: '2026-10-23T02:00:00.000Z',
});
export const STAFF_REPLY_TEXT = 'Đơn của bạn đang được đóng gói, mai giao nhé.';
export const CUSTOMER_TEXT = 'Cho mình hỏi đơn TUBU-1234 khi nào giao?';

export interface SupportChatState {
  messages: SupportChatMessageDTO[];
  sent: SupportChatSendInput[];
}

/**
 * Chat khách có trạng thái: tin gửi đi được lưu lại; tin Tubu Tree trả lời chỉ hiện ở lần GET thứ hai sau khi gửi
 * (lần đầu là lần hỏi lại ngay sau khi gửi, lần hai là nhịp hỏi định kỳ), đúng như nhân viên trả lời sau đó.
 */
export function mockSupportChat(api: MockApi): SupportChatState {
  const state: SupportChatState = { messages: [GREETING], sent: [] };
  let getsSinceSend = -1;
  api.get('/config/public', CHAT_ENABLED_CONFIG);
  api.get('/orders', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/me/support-chat', (): SupportChatThreadDTO => {
    if (getsSinceSend >= 0) {
      getsSinceSend += 1;
      if (getsSinceSend === 2) {
        state.messages.push(msg({ id: 'sm-3', sender: 'STAFF', body: STAFF_REPLY_TEXT, createdAt: '2026-10-23T02:02:00.000Z' }));
      }
    }
    return { code: 'K7Q2', blocked: false, enabled: true, slow: false, messages: [...state.messages], hasMore: false };
  });
  api.get('/me/support-chat/summary', { unreadCount: 0 });
  api.post('/me/support-chat/read', { ok: true });
  api.post('/me/support-chat/messages', ({ call }) => {
    const input = call.body as SupportChatSendInput;
    state.sent.push(input);
    const m = msg({
      id: 'sm-2',
      sender: 'CUSTOMER',
      body: input.body ?? '',
      clientMsgId: input.clientMsgId,
      createdAt: '2026-10-23T02:01:00.000Z',
    });
    state.messages.push(m);
    getsSinceSend = 0;
    return m;
  });
  return state;
}

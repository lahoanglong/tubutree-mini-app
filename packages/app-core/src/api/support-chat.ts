import type { SupportChatMessageDTO, SupportChatPageDTO, SupportChatSendInput, SupportChatThreadDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

export const getSupportChat = (http: HttpClient) => http.get<SupportChatThreadDTO>('/me/support-chat');
export const getSupportChatPage = (http: HttpClient, q: { after?: string; before?: string }) =>
  http.get<SupportChatPageDTO>('/me/support-chat/messages', { query: q });
export const sendSupportChat = (http: HttpClient, input: SupportChatSendInput) => http.post<SupportChatMessageDTO>('/me/support-chat/messages', input);
export const markSupportChatRead = (http: HttpClient) => http.post<{ ok: boolean }>('/me/support-chat/read');
export const getSupportChatSummary = (http: HttpClient) => http.get<{ unreadCount: number }>('/me/support-chat/summary');

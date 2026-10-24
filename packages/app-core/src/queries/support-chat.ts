import type { HttpClient } from '../http';
import { getSupportChat, getSupportChatSummary } from '../api/support-chat';

export const supportChatQuery = (http: HttpClient) => ({ queryKey: ['support-chat'] as const, queryFn: () => getSupportChat(http) });
export const supportChatSummaryQuery = (http: HttpClient) => ({ queryKey: ['support-chat-summary'] as const, queryFn: () => getSupportChatSummary(http) });

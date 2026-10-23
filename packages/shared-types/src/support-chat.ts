export type SupportSender = 'CUSTOMER' | 'STAFF' | 'SYSTEM';
export interface SupportChatContext { orderCode?: string; productSlug?: string }
export interface SupportChatMessageDTO {
  id: string; sender: SupportSender; body: string; imageUrl: string | null;
  context: SupportChatContext | null; clientMsgId: string | null; createdAt: string;
}
export interface SupportChatThreadDTO {
  code: string; blocked: boolean; enabled: boolean; slow: boolean;
  messages: SupportChatMessageDTO[]; hasMore: boolean;
}
export interface SupportChatPageDTO { messages: SupportChatMessageDTO[]; hasMore: boolean }
export interface SupportChatSendInput {
  clientMsgId: string; body?: string; imageUrl?: string; context?: SupportChatContext;
  source?: 'MINIAPP' | 'WEB';
}
export type ZaloBridgeState = 'CONNECTED' | 'CONNECTING' | 'NEED_QR' | 'KICKED' | 'ERROR' | 'UNREACHABLE';
export type ZaloBridgeEvent =
  | { type: 'message'; groupId: string; msgId: string; cliMsgId: string; uidFrom: string; dName: string;
      isSelf: boolean; ts: number; text: string | null; imageUrl: string | null;
      quote: { globalMsgId: string; cliMsgId: string; text: string | null } | null }
  | { type: 'undo'; groupId: string; msgId: string }
  | { type: 'state'; state: Exclude<ZaloBridgeState, 'UNREACHABLE'>; since: string; lastError: string | null;
      zaloUid: string | null; displayName: string | null };
export interface ZaloBridgeHealth {
  state: Exclude<ZaloBridgeState, 'UNREACHABLE'>; zaloUid: string | null; displayName: string | null;
  avatar: string | null; since: string; lastError: string | null; queueSize: number; outboxSize: number; groupId: string | null;
}

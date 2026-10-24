export type ZaloBridgeState = 'CONNECTED' | 'CONNECTING' | 'NEED_QR' | 'KICKED' | 'ERROR' | 'UNREACHABLE';

export type ZaloBridgeEvent =
  | {
      type: 'message';
      groupId: string;
      msgId: string;
      cliMsgId: string;
      uidFrom: string;
      dName: string;
      isSelf: boolean;
      ts: number;
      text: string | null;
      imageUrl: string | null;
      quote: { globalMsgId: string; cliMsgId: string; text: string | null } | null;
      // msgType của tin trả lời trích tin mà cầu nối không chuyển được (sticker, tệp, thoại...); thiếu = tin chữ/ảnh bình thường
      unsupportedType?: string;
    }
  | { type: 'undo'; groupId: string; msgId: string }
  | {
      type: 'state';
      state: Exclude<ZaloBridgeState, 'UNREACHABLE'>;
      since: string;
      lastError: string | null;
      zaloUid: string | null;
      displayName: string | null;
    };

export interface ZaloBridgeHealth {
  state: Exclude<ZaloBridgeState, 'UNREACHABLE'>;
  zaloUid: string | null;
  displayName: string | null;
  avatar: string | null;
  since: string;
  lastError: string | null;
  queueSize: number;
  outboxSize: number;
  groupId: string | null;
  lastEventAt: string | null;
  lastSentAt: string | null;
  listenerErrors: number;
  outboxDropped: number;
}

export interface ZaloCredentials {
  cookie: unknown;
  imei: string;
  userAgent: string;
  savedAt: string;
}

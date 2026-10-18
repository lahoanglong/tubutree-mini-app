/** Kết quả chia sẻ: `cancelled` là khách tự đóng hộp chia sẻ, không phải lỗi. */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareInput {
  title: string;
  text?: string;
  /** Đường dẫn trong app đang chạy (`/san-pham/x` trên web, `/product/x` trong Mini App), không kèm tên miền. */
  path: string;
}

export interface PlatformCapabilities {
  verifiedPhone: boolean;
  zaloLocation: boolean;
  qrScan: boolean;
  zaloNotifyPermission: boolean;
}

export interface PlatformBridge {
  platform: 'miniapp' | 'web';
  capabilities: PlatformCapabilities;
  share(input: ShareInput): Promise<ShareResult>;
  openExternal(url: string): void;
  callPhone(phone: string): void;
  oa: {
    available: boolean;
    openChat(message?: string): Promise<void>;
    /** `false` khi không theo dõi được (OA chưa cấu hình, khách từ chối, hoặc web không đọc được trạng thái). */
    follow(): Promise<boolean>;
  };
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
}

/** URL từ API/admin chỉ được mở khi là http(s): javascript:/data: chạy với origin của app. */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

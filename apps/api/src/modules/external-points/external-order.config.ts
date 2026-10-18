/** Khoá cấu hình nhận đơn Pancake ngoài app (đơn sàn, chat, điện thoại). */
export const EXTERNAL_CAPTURE_ENABLED_KEY = 'pancake.external_capture_enabled';
export const ORDER_SOURCE_MAP_KEY = 'pancake.order_source_map';

export const DEFAULT_EXTERNAL_CAPTURE_ENABLED = true;

export interface OrderSourceMap {
  /** Khoá là `marketplace_id` của đơn Pancake (số, có thể âm), giá trị là tên sàn. */
  marketplaceIds: Record<string, string>;
  /** Mỗi phần tử là một `sourceKey` (`order_sources|account|marketplace_id`) của đơn chat/điện thoại. */
  chatSources: string[];
}

export const DEFAULT_ORDER_SOURCE_MAP: OrderSourceMap = {
  marketplaceIds: { '-3': 'shopee', '-4': 'lazada', '-9': 'tiktok' },
  chatSources: [],
};

const CHANNEL_NAME = /^[a-z][a-z0-9_]{0,19}$/;
const MAX_CHAT_SOURCES = 100;
const MAX_SOURCE_KEY_LENGTH = 200;

/** Lỗi của giá trị `pancake.order_source_map` (null = hợp lệ). Sai thì mọi đơn sàn rơi xuống UNKNOWN nên chặn ngay lúc ghi. */
export function orderSourceMapProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'phải là object {marketplaceIds, chatSources}';
  const v = value as Record<string, unknown>;
  const ids = v['marketplaceIds'];
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) return 'marketplaceIds phải là object dạng {"-3":"shopee"}';
  for (const [id, channel] of Object.entries(ids)) {
    if (!/^-?\d{1,9}$/.test(id)) return `marketplaceIds: khoá "${id}" phải là số nguyên`;
    if (typeof channel !== 'string' || !CHANNEL_NAME.test(channel)) {
      return `marketplaceIds["${id}"] phải là tên sàn viết thường, vd "shopee"`;
    }
  }
  const chat = v['chatSources'];
  if (!Array.isArray(chat) || chat.length > MAX_CHAT_SOURCES) return `chatSources phải là mảng tối đa ${MAX_CHAT_SOURCES} khoá nguồn`;
  for (const s of chat) {
    if (typeof s !== 'string' || !s.trim() || s.length > MAX_SOURCE_KEY_LENGTH) {
      return 'chatSources chỉ gồm chuỗi khoá nguồn không rỗng (order_sources|account|marketplace_id)';
    }
  }
  return null;
}

/** Giá trị hỏng hoặc thiếu thì dùng mặc định (đọc lỏng ở phía xử lý webhook, không bao giờ ném). */
export function resolveOrderSourceMap(value: unknown): OrderSourceMap {
  if (orderSourceMapProblem(value) !== null) return DEFAULT_ORDER_SOURCE_MAP;
  const v = value as OrderSourceMap;
  return { marketplaceIds: { ...v.marketplaceIds }, chatSources: [...v.chatSources] };
}

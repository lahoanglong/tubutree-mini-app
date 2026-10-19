import type { PlatformBridge } from '@tubutree/app-core/bridge';

const OA_PROMPT_STORAGE_KEY = 'tubu_oa_prompt';

export interface OaPromptState {
  /** Đã hỏi theo dõi OA rồi (khách bấm theo dõi HOẶC bấm "Để sau"): không hỏi lại nữa. */
  promptSeen: boolean;
  /** Chỉ để tham khảo: web không đọc được trạng thái theo dõi thật nên không phải nguồn sự thật. */
  followed: boolean;
}
const DEFAULT_STATE: OaPromptState = { promptSeen: false, followed: false };

/** Đọc cờ đã-hỏi lưu trên máy (per-device, không đồng bộ server). */
export async function getOaPromptState(storage: PlatformBridge['storage']): Promise<OaPromptState> {
  try {
    const raw = await storage.get(OA_PROMPT_STORAGE_KEY);
    if (typeof raw === 'string') return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<OaPromptState>) };
  } catch {
    /* storage lỗi hoặc dữ liệu hỏng: coi như chưa hỏi lần nào, không chặn luồng */
  }
  return DEFAULT_STATE;
}

/** Ghi cờ (gộp với giá trị cũ) sau khi khách bấm theo dõi hoặc "Để sau". */
export async function setOaPromptState(storage: PlatformBridge['storage'], patch: Partial<OaPromptState>): Promise<void> {
  try {
    const next = { ...(await getOaPromptState(storage)), ...patch };
    await storage.set(OA_PROMPT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ghi thất bại thì thôi: không chặn UI vì việc này */
  }
}

/** Chỉ mời khi đã cấu hình OA, chưa từng hỏi trên máy này và đây là đơn DUY NHẤT của khách (đúng lúc thiện chí cao nhất). */
export function shouldShowFollowOaPrompt(params: { hasOA: boolean; promptSeen: boolean; ordersTotal: number | undefined }): boolean {
  return params.hasOA && !params.promptSeen && params.ordersTotal === 1;
}

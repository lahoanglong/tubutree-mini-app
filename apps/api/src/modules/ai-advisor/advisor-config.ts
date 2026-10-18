export type AdvisorProvider = 'antigravity' | 'deepseek' | 'gemini';

export type EnvGetter = (key: string) => string | undefined;

const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

const clean = (get: EnvGetter, key: string): string => (get(key) ?? '').trim();

/** Rỗng hoặc sai kiểu → mặc định (giá trị .env gõ nhầm không được làm hỏng khởi động hay khoá cứng giới hạn về 0). */
export function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Công tắc tắt khẩn cấp: chỉ các giá trị tắt rõ ràng mới tắt, để trống là bật. */
export function isAdvisorEnabled(get: EnvGetter): boolean {
  return !OFF_VALUES.has(clean(get, 'AI_ADVISOR_ENABLED').toLowerCase());
}

export function providerConfigured(get: EnvGetter, p: AdvisorProvider): boolean {
  if (p === 'antigravity') return Boolean(clean(get, 'ANTIGRAVITY_GATEWAY_URL') && clean(get, 'ANTIGRAVITY_GATEWAY_KEY'));
  if (p === 'deepseek') return Boolean(clean(get, 'DEEPSEEK_API_KEY'));
  return Boolean(clean(get, 'GEMINI_API_KEY'));
}

/**
 * Thứ tự thử provider. Chọn rõ AI_ADVISOR_PROVIDER thì CHỈ dùng provider đó (không âm thầm rơi sang
 * provider khác có key cũ còn sót); để trống thì tự chọn antigravity > deepseek > gemini theo cái đã cấu hình.
 */
export function resolveProviderOrder(get: EnvGetter): AdvisorProvider[] {
  const picked = clean(get, 'AI_ADVISOR_PROVIDER').toLowerCase();
  if (picked === 'antigravity' || picked === 'deepseek' || picked === 'gemini') {
    return providerConfigured(get, picked) ? [picked] : [];
  }
  return (['antigravity', 'deepseek', 'gemini'] as const).filter((p) => providerConfigured(get, p));
}

/** Nguồn sự thật cho cả LlmClient lẫn GET /config/public: bật VÀ có ít nhất một provider dùng được. */
export function isAdvisorAvailable(get: EnvGetter): boolean {
  return isAdvisorEnabled(get) && resolveProviderOrder(get).length > 0;
}

export const MIN_WEBHOOK_SECRET_LENGTH = 32;

/** Secret xác thực bên ngoài gọi vào (các route này đều @SkipThrottle nên độ dài secret là hàng rào duy nhất chống dò). */
export const WEBHOOK_SECRET_KEYS = [
  'PANCAKE_WEBHOOK_SECRET',
  'GOMDON_WEBHOOK_SECRET',
  'ZALO_OA_WEBHOOK_SECRET',
  'ZALO_BRIDGE_SECRET',
  'ACCESSTRADE_WEBHOOK_SECRET',
] as const;

/** Secret đã đặt (không rỗng) mà ngắn hơn 32 ký tự. Rỗng là "chưa dùng", do từng tính năng tự quyết có bắt buộc hay không. */
export function shortWebhookSecretKeys(env: object): string[] {
  return WEBHOOK_SECRET_KEYS.filter((k) => {
    const v = (env as Record<string, unknown>)[k];
    return typeof v === 'string' && v.length > 0 && v.length < MIN_WEBHOOK_SECRET_LENGTH;
  });
}

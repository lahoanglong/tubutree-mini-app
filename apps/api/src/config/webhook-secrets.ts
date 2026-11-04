export const MIN_WEBHOOK_SECRET_LENGTH = 32;

/** Secret xác thực bên ngoài gọi vào (các route này đều @SkipThrottle nên độ dài secret là hàng rào duy nhất chống dò). */
export const WEBHOOK_SECRET_KEYS = [
  'PANCAKE_WEBHOOK_SECRET',
  'GOMDON_WEBHOOK_SECRET',
  'ZALO_OA_WEBHOOK_SECRET',
  'ZALO_BRIDGE_SECRET',
  'ACCESSTRADE_WEBHOOK_SECRET',
] as const;

/** Secret đã đặt (không rỗng) mà ngắn hơn 32 ký tự và thật sự dùng để xác thực. Rỗng là "chưa dùng", do từng tính năng tự quyết có bắt buộc hay không. */
export function shortWebhookSecretKeys(env: object): string[] {
  const e = env as Record<string, unknown>;
  // Webhook OA có đủ khoá ký + app id thì chữ ký là cửa duy nhất và token tĩnh bị bỏ qua (ZaloOaWebhookController.signingReady).
  const oaSigning = Boolean(e.ZALO_OA_SECRET_KEY) && Boolean(e.ZALO_APP_ID);
  return WEBHOOK_SECRET_KEYS.filter((k) => {
    if (k === 'ZALO_OA_WEBHOOK_SECRET' && oaSigning) return false;
    const v = e[k];
    return typeof v === 'string' && v.length > 0 && v.length < MIN_WEBHOOK_SECRET_LENGTH;
  });
}

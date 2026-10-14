import { validateEnv } from './env.validation';

/**
 * Kiểm cấu hình môi trường như lúc API khởi động, nhưng không khởi động gì. tools/deploy/deploy.sh chạy file này
 * bằng image MỚI (`node dist/config/check-env.js`) trước khi migrate/thay container: .env thiếu khoá vừa thành bắt
 * buộc hay URL gõ sai thì dừng deploy, API cũ vẫn phục vụ — thay vì container mới crash-loop sau khi cũ đã bị thay.
 */
export function checkEnv(env: Record<string, unknown>): { ok: boolean; message: string } {
  try {
    validateEnv(env);
    return { ok: true, message: 'Cấu hình môi trường hợp lệ.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

if (require.main === module) {
  const r = checkEnv(process.env);
  (r.ok ? console.log : console.error)(r.message);
  process.exit(r.ok ? 0 : 1);
}

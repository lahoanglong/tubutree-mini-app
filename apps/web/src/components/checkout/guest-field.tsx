import { AlertTriangle } from 'lucide-react';

/**
 * Nhãn, gợi ý và lỗi của một ô nhập trên các biểu mẫu khách chưa đăng nhập (thanh toán `/thanh-toan`, tra cứu `/don`). Ô nhập nối gợi ý và
 * lỗi bằng `aria-describedby` = `<id>-hint` / `<id>-err`.
 */
export function GuestField({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-field-label text-[color:var(--color-text-secondary)]">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-caption text-[color:var(--color-text-tertiary)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-0.5 flex items-start gap-1 text-caption text-danger-fg">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

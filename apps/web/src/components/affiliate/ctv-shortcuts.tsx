import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export interface CtvShortcut {
  key: string;
  /** Nhãn ngắn hiện trên nút (vừa một cột 1/4 màn hình). */
  label: string;
  /** Tên đầy đủ cho trình đọc màn hình; phải chứa nhãn hiển thị (WCAG 2.5.3). */
  ariaLabel?: string;
  icon: LucideIcon;
  /** Có `href` thì là liên kết (đi sang trang khác), không thì là nút. */
  href?: string;
  onPress?: () => void;
  disabled?: boolean;
}

const BASE =
  'flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-card bg-stone-0 px-1 py-2.5 text-center text-xs font-semibold shadow-card transition';

/** Hàng lối tắt ngay dưới thẻ hoa hồng: việc CTV làm hằng ngày (chia sẻ, gian hàng, lên đơn hộ, chuyển hoa hồng vào Ví) không phải cuộn tới cuối trang dài. */
export function CtvShortcuts({ items }: { items: CtvShortcut[] }) {
  return (
    <div role="group" aria-label="Lối tắt của CTV" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(({ key, label, ariaLabel, icon: Icon, href, onPress, disabled }) => {
        const inner = (
          <>
            <span aria-hidden="true" className={`grid h-9 w-9 place-items-center rounded-full ${disabled ? 'bg-stone-100 text-stone-500' : 'bg-forest-50 text-forest-600'}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className={disabled ? 'text-stone-500' : 'text-stone-900'}>{label}</span>
          </>
        );
        const cls = `${BASE} min-h-[76px] ${disabled ? '' : 'active:scale-95 hover:bg-stone-50'}`;
        return href ? (
          <Link key={key} href={href} aria-label={ariaLabel} className={cls}>
            {inner}
          </Link>
        ) : (
          <button key={key} type="button" aria-label={ariaLabel} disabled={disabled} onClick={onPress} className={cls}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

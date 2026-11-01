import { ChevronDown, ChevronUp } from 'lucide-react';
import { moveButtonLabel, type MoveDirection } from '@tubutree/app-core/commerce/storefront-builder';
import { Icon } from './icon';

export interface MoveButtonsProps {
  /** Id của món hoặc khối; nơi dùng tìm lại đúng nút để trả focus sau khi danh sách đổi chỗ. */
  id: string;
  name: string;
  scope?: 'item' | 'section';
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: MoveDirection) => void;
  /** Bấm lúc nút khoá (đầu/cuối danh sách, món ghim): báo lý do thay vì im lặng. */
  onBlocked?: (dir: MoveDirection) => void;
}

/**
 * Hai nút ↑↓ vuông 44px, tên có tên món ("Đưa Kem lên"): 40 nút "Đưa lên" trùng tên là bẫy của trình đọc màn hình. Ở rìa dùng
 * `aria-disabled` chứ không `disabled`: nút `disabled` đang focus làm trình duyệt đẩy focus về body, người dùng phải Tab lại từ đầu.
 */
export function MoveButtons({ id, name, scope = 'item', canUp, canDown, onMove, onBlocked }: MoveButtonsProps) {
  const one = (dir: MoveDirection) => {
    const can = dir === 'up' ? canUp : canDown;
    return (
      <button
        key={dir}
        type="button"
        aria-label={moveButtonLabel(dir, name, scope)}
        aria-disabled={can ? undefined : true}
        data-move-id={id}
        data-move-dir={dir}
        className="tubu-press"
        onClick={() => (can ? onMove(dir) : onBlocked?.(dir))}
        style={{
          minWidth: 44, minHeight: 44, flexShrink: 0, border: 'none', background: 'transparent', borderRadius: 'var(--radius-pill)',
          cursor: can ? 'pointer' : 'default', opacity: can ? 1 : 0.35, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
      >
        <Icon icon={dir === 'up' ? ChevronUp : ChevronDown} size="sm" tone="muted" />
      </button>
    );
  };
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      {one('up')}
      {one('down')}
    </span>
  );
}

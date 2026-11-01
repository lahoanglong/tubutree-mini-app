import { SHORTCUT_TINT_VARS, type HomeShortcutSpec } from '@tubutree/app-core/home-layout';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { haptic } from '../../utils/haptic';
import { BottomSheet } from '../ui/bottom-sheet';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { SHORTCUT_ICONS } from './shortcut-visuals';

export interface ShortcutsSheetProps {
  open: boolean;
  onClose: () => void;
  items: HomeShortcutSpec[];
  /** `onSelect` lo điều hướng/mở sheet con để sheet này không biết đích. */
  onSelect: (item: HomeShortcutSpec) => void;
}

/** "Tất cả lối tắt" (Q7): mọi mục còn hiển thị, mỗi mục một dòng, câu đọc đầy đủ làm mô tả để ô 4 chữ ở Trang chủ không phải gánh ý nghĩa. */
export function ShortcutsSheet({ open, onClose, items, onSelect }: ShortcutsSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={homeCopy.shortcuts.allAria}>
      <div>
        {items.map((it, i) => {
          const tint = SHORTCUT_TINT_VARS[it.tint];
          return (
            <ListRow
              key={it.id}
              icon={
                <span aria-hidden style={{ width: 36, height: 36, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <Icon icon={SHORTCUT_ICONS[it.id]} size="sm" tone="current" />
                </span>
              }
              title={it.label}
              subtitle={it.ariaLabel}
              trailing="chevron"
              onPress={() => {
                haptic('light');
                onSelect(it);
              }}
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
            />
          );
        })}
      </div>
    </BottomSheet>
  );
}

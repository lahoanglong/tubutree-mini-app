import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { haptic } from '../../utils/haptic';
import '../../css/declutter.css';

export interface PdpDetailRowProps {
  /** Khoá khối (`PDP_BLOCK_ORDER`): `data-pdp-block` của dòng, test-id `pdp-<khối>` và `pdp-<khối>-toggle`. */
  block: 'ingredients' | 'origin' | 'description';
  title: string;
  /** Chữ phụ bên phải tiêu đề khi đang gập ("5 thành phần", tỉnh của nhãn). */
  hint?: string | null;
  children: ReactNode;
}

/**
 * Một dòng gập sẵn của dải "Chi tiết sản phẩm" (w47-01): cả dòng tiêu đề là nút (cao 48px), mở ra là nội dung. Nội dung đang gập vẫn nằm trong cây (thuộc tính
 * `hidden`), nên web giữ đủ chữ cho máy tìm kiếm; cùng số đo với `apps/web/src/components/mini/pdp-detail-row.tsx`.
 */
export function PdpDetailRow({ block, title, hint, children }: PdpDetailRowProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section data-pdp-block={block} data-testid={`pdp-${block}`} aria-label={title} className="tubu-pdp-detail">
      <button
        type="button"
        data-testid={`pdp-${block}-toggle`}
        aria-expanded={open}
        aria-controls={bodyId}
        className="tubu-pdp-detail-toggle tubu-press"
        onClick={() => {
          haptic('light');
          setOpen((o) => !o);
        }}
      >
        <span className="tubu-pdp-detail-title">{title}</span>
        {hint && !open && <span className="tubu-pdp-detail-hint">{hint}</span>}
        <ChevronDown size={16} aria-hidden="true" className="tubu-pdp-detail-chevron" />
      </button>
      <div id={bodyId} hidden={!open} className="tubu-pdp-detail-body">
        {children}
      </div>
    </section>
  );
}

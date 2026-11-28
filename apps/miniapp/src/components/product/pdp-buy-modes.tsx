import { Children, type ReactNode } from 'react';
import type { PdpBuyModeKey, PdpBuyModeOption } from '@tubutree/app-core/commerce/pdp-buy-modes';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { haptic } from '../../utils/haptic';
import '../../css/declutter.css';

export interface PdpBuyModesProps {
  /** Các nút của dải (`pdpBuyModes` của app-core, Mua lẻ đứng đầu); trang không vẽ dải khi chỉ có Mua lẻ. */
  modes: readonly PdpBuyModeOption[];
  mode: PdpBuyModeKey;
  onModeChange: (mode: PdpBuyModeKey) => void;
  /** Dòng chi tiết của chế độ đang chọn (thẻ gói Refill, lối mở Đặt định kỳ); Mua lẻ thì không có. */
  children?: ReactNode;
}

/**
 * MỘT dải chọn cách mua ngay dưới Số lượng (w47-01) thay ba khối chồng nhau. Mỗi nút là nút bật/tắt (`aria-pressed`) trong một nhóm có tên; chỉ chế độ
 * đang chọn mới có một dòng chi tiết bên dưới với một hành động, nên không còn hai nút "+ Thêm" tranh nhau với nút mua ở thanh dưới.
 */
export function PdpBuyModes({ modes, mode, onModeChange, children }: PdpBuyModesProps) {
  return (
    <div data-pdp-block="modes" data-testid="pdp-buy-modes" className="tubu-buy-modes">
      <div role="group" aria-label={fillCopy('pdp.modesLabel')} className="tubu-buy-modes-row">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            data-mode={m.key}
            aria-pressed={m.key === mode}
            // Hai dòng chữ dính nhau khi đọc ("Định kỳTiết kiệm 12%"): tên đọc tách bằng dấu phẩy, vẫn bắt đầu bằng nhãn thấy được.
            aria-label={m.tag ? `${m.label}, ${m.tag}` : undefined}
            className="tubu-buy-mode tubu-press"
            onClick={() => {
              if (m.key === mode) return;
              haptic('light');
              onModeChange(m.key);
            }}
          >
            <span className="tubu-buy-mode-label">{m.label}</span>
            {/* Khoảng trắng giữa hai dòng: chữ thấy được đọc liền thành "Định kỳ Tiết kiệm 12%", nằm trọn trong tên đọc (axe label-content-name-mismatch). */}
            {m.tag && ' '}
            {m.tag && <span className="tubu-buy-mode-tag">{m.tag}</span>}
          </button>
        ))}
      </div>
      {/* Trang truyền `[false, false]` ở chế độ Mua lẻ: đếm con thật để không vẽ khung rỗng có lề trên. */}
      {Children.toArray(children).length > 0 && (
        <div data-testid="pdp-buy-mode-detail" className="tubu-buy-modes-detail">
          {children}
        </div>
      )}
    </div>
  );
}

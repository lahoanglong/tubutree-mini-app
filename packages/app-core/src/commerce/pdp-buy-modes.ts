import type { PdpRefillOfferView } from '../refill/refill-saving';
import { fillCopy } from '../shop-copy';

/**
 * Dải chọn cách mua ở trang sản phẩm (Mini App và web, THUẦN): MỘT hàng nút "Mua lẻ / Túi Refill / Định kỳ" thay cho ba khối chồng nhau (thẻ gói
 * Refill có nút "+ Thêm", dòng Đặt định kỳ). "Mua lẻ" luôn đứng đầu và là lựa chọn mặc định: nút mua ở thanh dưới vẫn mua đúng phân loại đang xem.
 * Chọn chế độ khác thì chỉ chế độ đó hiện một dòng chi tiết với một hành động (thêm gói Refill, mở tấm Đặt định kỳ).
 */
export type PdpBuyModeKey = 'retail' | 'refill' | 'subscribe';

export interface PdpBuyModeOption {
  key: PdpBuyModeKey;
  label: string;
  /** Dòng phụ dưới nhãn ("Tiết kiệm 12%"); null khi không có số đúng để nói (không hứa số). */
  tag: string | null;
}

export interface PdpBuyModesInput {
  /** Thẻ gói Refill (`pdpRefillOffer`); null khi chai chưa ghép gói, gói hết hàng hay gian hàng chưa nhận đơn. */
  refill: Pick<PdpRefillOfferView, 'comparison' | 'pack'> | null;
  /** Đặt định kỳ dùng được cho phân loại đang chọn (còn hàng, không phải hàng chỉ bán giá lẻ). */
  subscribe: boolean;
  /** `subscribePct` của cấu hình; null thì nút không nêu số. */
  subscribePct: number | null;
}

function option(key: PdpBuyModeKey, label: string, tag: string | null): PdpBuyModeOption {
  return { key, label, tag };
}

/** Các nút của dải; null khi chỉ có "Mua lẻ" (không vẽ dải: một lựa chọn thì không phải chọn). */
export function pdpBuyModes(input: PdpBuyModesInput): PdpBuyModeOption[] | null {
  const modes: PdpBuyModeOption[] = [option('retail', fillCopy('pdp.modeRetail'), null)];
  if (input.refill) {
    const pct = input.refill.comparison?.savedPct;
    modes.push(
      option(
        'refill',
        fillCopy(input.refill.pack === 'can' ? 'pdp.modeRefillCan' : 'pdp.modeRefillBag'),
        typeof pct === 'number' && pct > 0 ? fillCopy('pdp.modeSaveApprox', { pct }) : null,
      ),
    );
  }
  if (input.subscribe) {
    modes.push(option('subscribe', fillCopy('pdp.modeSubscribe'), input.subscribePct ? fillCopy('pdp.modeSave', { pct: input.subscribePct }) : null));
  }
  return modes.length > 1 ? modes : null;
}

/** Chế độ đang chọn còn hợp lệ không (vd khách chọn Định kỳ rồi đổi sang phân loại hết hàng): không thì quay về "Mua lẻ". */
export function pdpBuyModeOrRetail(modes: readonly PdpBuyModeOption[] | null, picked: PdpBuyModeKey): PdpBuyModeKey {
  return modes?.some((m) => m.key === picked) ? picked : 'retail';
}

import { fillTemplate } from '../copy-template';

/**
 * Chữ nhãn xanh trên thẻ và các dòng của khối "Điểm cộng xanh" ở trang sản phẩm (cả hai app). Tách như `TILE_COPY` vì `productCardView` (gói
 * đầu) dùng nhãn; `SHOP_COPY` spread lại bảng này nên ngân sách độ dài nằm ở `shop-copy-budget.ts`. Chữ chỉ web (link nguồn, thẻ so sánh, lối
 * vào hộ chiếu) ở `web-copy.ts` để không vào gói Mini. Mọi câu qua bộ chặn tuyên bố (`eco.spec.ts`); số luôn kèm "~" hay "ước tính".
 */
export const ECO_COPY = {
  'eco.badgeRefill': 'Can refill',
  'eco.badgePlastic': 'Giảm ~{g} nhựa',
  'eco.badgePlasticSpoken': 'Giảm khoảng {g} nhựa, ước tính',
  'eco.badgeReturn': 'Trả vỏ đổi điểm',
  'eco.title': 'Điểm cộng xanh',
  'eco.refill': 'Dạng can refill để rót lại vào chai bạn đang có',
  'eco.plastic': 'Giảm khoảng {g} nhựa mỗi món (ước tính)',
  'eco.plasticVs': 'Giảm khoảng {g} nhựa mỗi món, {base} (ước tính)',
  'eco.return': 'Vỏ trả lại được qua Đổi rác lấy quà',
  'eco.sourceOf': 'Nguồn: {host}',
} as const;

export type EcoCopyKey = keyof typeof ECO_COPY;

export function fillEcoCopy(key: EcoCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(ECO_COPY[key], vars, key);
}

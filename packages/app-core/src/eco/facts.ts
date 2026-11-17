import { fillEcoCopy } from './copy';

/** Cùng tập loại với enum `EcoFactKind` của API (`apps/api/prisma/schema.prisma`). */
export type EcoFactKind = 'REFILL_PACK' | 'PLASTIC_AVOIDED' | 'RETURNABLE_PACKAGING' | 'CERTIFICATION' | 'INGREDIENT_ORIGIN';

/** Sự thật đã duyệt trên thẻ (`ProductCard.ecoFacts`): không có link. API chỉ trả khi cờ `eco.product_badges_enabled` bật. */
export interface CardEcoFact {
  kind: EcoFactKind;
  valueGrams: number | null;
  label: string | null;
}

/** Sự thật đã duyệt ở trang sản phẩm (`ProductDetail.ecoFacts`): `variationId` null là của cả sản phẩm. */
export interface PublicEcoFact extends CardEcoFact {
  variationId: string | null;
  baselineText: string | null;
  co2Grams: number | null;
  sourceUrl: string;
}

const KIND_ORDER: readonly EcoFactKind[] = ['REFILL_PACK', 'PLASTIC_AVOIDED', 'RETURNABLE_PACKAGING', 'CERTIFICATION', 'INGREDIENT_ORIGIN'];
/** Chữ giấy tờ dài hơn mức này không lên thẻ (nhãn một dòng ở đầu tên), chỉ ở trang sản phẩm. */
const CARD_LABEL_MAX = 14;

const isKind = (k: unknown): k is EcoFactKind => typeof k === 'string' && (KIND_ORDER as readonly string[]).includes(k);
const posInt = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null);

/**
 * Gam làm tròn tới 10 g (dưới 10 g giữ đúng số, không nâng lên); từ 1.000 g hiện kg một chữ số thập phân. Dưới 1.000 g không bao giờ hiện
 * "1,0 kg" (chặn ở 990 g) để chữ khớp mốc "1 kg nhựa" của hộ chiếu. `compact` bỏ dấu cách ("120g") cho nhãn thẻ, như chữ "Giảm ~120g nhựa"
 * của thiết kế. Không có số dương thì null (nơi gọi không vẽ số).
 */
export function ecoGrams(grams: number | null | undefined, compact = false): string | null {
  const g = posInt(grams);
  if (g === null) return null;
  const sp = compact ? '' : ' ';
  if (g < 1000) return `${g < 10 ? g : Math.min(990, Math.round(g / 10) * 10)}${sp}g`;
  return `${(Math.round(g / 100) / 10).toFixed(1).replace('.', ',')}${sp}kg`;
}

/** Dạng đọc an toàn của danh sách từ API: bỏ dòng sai kiểu, giữ thứ tự loại cố định. API cũ hay cờ tắt (không có trường) thì rỗng. */
export function readEcoFacts<T extends CardEcoFact>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const ok = raw.filter((f): f is T => !!f && typeof f === 'object' && isKind((f as CardEcoFact).kind));
  return ok.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

export interface EcoBadgeText {
  text: string;
  spoken: string;
}

/**
 * Nhãn xanh duy nhất của thẻ, thứ tự Can refill > Giảm nhựa > Trả vỏ > giấy tờ (chữ ngắn). `productCardView` đặt nó sau "Mới" trong khe
 * nhãn đầu tên, nên thẻ không cao thêm. Không có sự thật hợp lệ thì null.
 */
export function ecoCardBadge(facts: unknown): EcoBadgeText | null {
  for (const f of readEcoFacts<CardEcoFact>(facts)) {
    if (f.kind === 'REFILL_PACK') return same(fillEcoCopy('eco.badgeRefill'));
    if (f.kind === 'PLASTIC_AVOIDED') {
      const g = ecoGrams(f.valueGrams, true);
      if (g) return { text: fillEcoCopy('eco.badgePlastic', { g }), spoken: fillEcoCopy('eco.badgePlasticSpoken', { g: ecoGrams(f.valueGrams)! }) };
    }
    if (f.kind === 'RETURNABLE_PACKAGING') return same(fillEcoCopy('eco.badgeReturn'));
    if (f.kind === 'CERTIFICATION') {
      const label = typeof f.label === 'string' ? f.label.trim() : '';
      if (label && label.length <= CARD_LABEL_MAX) return same(label);
    }
  }
  return null;
}

const same = (text: string): EcoBadgeText => ({ text, spoken: text });

export interface EcoFactLine {
  kind: EcoFactKind;
  text: string;
  sourceUrl: string;
  /** Tên miền của nguồn ("pannature.org"): Mini App chỉ ghi chữ vì webview Zalo chặn link ngoài. */
  sourceHost: string;
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

/** Sự thật áp cho phân loại đang chọn: dòng cả sản phẩm cộng dòng của đúng phân loại; cùng loại thì dòng phân loại thắng. */
export function ecoFactsFor(facts: unknown, variationId: string | null | undefined): PublicEcoFact[] {
  const byKind = new Map<EcoFactKind, PublicEcoFact>();
  for (const f of readEcoFacts<PublicEcoFact>(facts)) {
    if (f.variationId != null && f.variationId !== variationId) continue;
    const prev = byKind.get(f.kind);
    if (!prev || (prev.variationId == null && f.variationId != null)) byKind.set(f.kind, f);
  }
  return [...byKind.values()];
}

function lineText(f: PublicEcoFact): string | null {
  const label = typeof f.label === 'string' ? f.label.trim() : '';
  switch (f.kind) {
    case 'REFILL_PACK':
      return fillEcoCopy('eco.refill');
    case 'PLASTIC_AVOIDED': {
      const g = ecoGrams(f.valueGrams);
      if (!g) return null;
      const base = typeof f.baselineText === 'string' ? f.baselineText.trim() : '';
      return base ? fillEcoCopy('eco.plasticVs', { g, base }) : fillEcoCopy('eco.plastic', { g });
    }
    case 'RETURNABLE_PACKAGING':
      return fillEcoCopy('eco.return');
    default:
      return label || null;
  }
}

/** Tối đa 4 dòng của khối "Điểm cộng xanh"; dòng thiếu nguồn https hay thiếu chữ bị bỏ. Rỗng thì trang ẩn cả khối. */
export function ecoFactLines(facts: unknown, variationId: string | null | undefined): EcoFactLine[] {
  const out: EcoFactLine[] = [];
  for (const f of ecoFactsFor(facts, variationId)) {
    const sourceHost = typeof f.sourceUrl === 'string' ? hostOf(f.sourceUrl) : null;
    const text = lineText(f);
    if (!sourceHost || !text) continue;
    out.push({ kind: f.kind, text, sourceUrl: f.sourceUrl, sourceHost });
    if (out.length === 4) break;
  }
  return out;
}

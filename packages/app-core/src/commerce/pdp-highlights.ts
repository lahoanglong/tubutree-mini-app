import type { EcoFactLine } from '../eco/facts';

/**
 * Khối "Điểm nổi bật" của trang sản phẩm (Mini App và web, THUẦN): gộp Điểm cộng xanh, mô tả ngắn và chứng nhận thành tối đa 3 dòng đọc lướt,
 * thay cho ba dải trắng chồng nhau. Chứng nhận (nếu có) gom thành một dòng chip; mỗi nguồn còn lại có ít nhất một dòng khi có dữ liệu; chỗ
 * còn thừa chia cho mô tả ngắn trước rồi tới Điểm cộng xanh. Thứ tự vẽ: lợi ích, Điểm cộng xanh, chứng nhận.
 */
export const PDP_HIGHLIGHTS_MAX = 3;

export type PdpHighlightRow =
  | { kind: 'benefit'; key: string; text: string }
  | { kind: 'eco'; key: string; text: string; sourceUrl: string; sourceHost: string; ecoKind: EcoFactLine['kind'] }
  | { kind: 'certs'; key: 'certs'; certs: readonly string[] };

const BULLET = /^[\s•●▪◦‣∙·*+✓✔✅-]+/u;
// Không tách sau chữ viết tắt hoa 1–3 ký tự ("TP. Hồ Chí Minh", "Q. 1"): dấu chấm đó không kết thúc câu.
const SENTENCE_END = /(?<!(?:^|[\s(])\p{Lu}{1,3}\.)(?<=[.!?;])\s+(?=\p{Lu})/u;

/** Mô tả ngắn thành các ý: mỗi dòng một ý (bỏ dấu đầu dòng); chỉ một dòng thì tách theo câu. */
export function benefitLines(text: string | null | undefined): string[] {
  const clean = (l: string) => l.replace(BULLET, '').trim();
  const lines = (text ?? '').split(/\n+/).map(clean).filter((l) => l !== '');
  if (lines.length !== 1) return lines;
  const sentences = lines[0]!.split(SENTENCE_END).map(clean).filter((l) => l !== '');
  return sentences.length > 1 ? sentences : lines;
}

/**
 * Mô tả ngắn có hơn một ý thì Điểm nổi bật (trần 3 dòng, chia chỗ với Điểm cộng xanh theo phân loại và chứng nhận) có thể cắt bớt: trả nguyên mô tả ngắn
 * để đặt đầu dòng gập "Mô tả chi tiết", khách vẫn đọc được đủ. Một ý thì Điểm nổi bật luôn có chỗ cho ý đó, không lặp lại.
 */
export function pdpDescriptionLead(benefit: string | null | undefined): string | null {
  const text = benefit?.trim() ?? '';
  return text !== '' && benefitLines(text).length > 1 ? text : null;
}

export function pdpHighlights(input: {
  benefit: string | null | undefined;
  certifications: readonly string[] | null | undefined;
  eco: readonly EcoFactLine[];
}): PdpHighlightRow[] {
  const certs = (input.certifications ?? []).filter((c) => typeof c === 'string' && c.trim() !== '');
  const benefits = benefitLines(input.benefit);
  const eco = input.eco;
  const room = PDP_HIGHLIGHTS_MAX - (certs.length > 0 ? 1 : 0);
  const nBenefit = Math.min(benefits.length, eco.length > 0 ? Math.max(1, room - eco.length) : room);
  const nEco = Math.min(eco.length, room - nBenefit);
  const rows: PdpHighlightRow[] = [
    ...benefits.slice(0, nBenefit).map((text, i) => ({ kind: 'benefit' as const, key: `benefit-${i}`, text })),
    ...eco.slice(0, nEco).map((l) => ({ kind: 'eco' as const, key: `eco-${l.kind}`, text: l.text, sourceUrl: l.sourceUrl, sourceHost: l.sourceHost, ecoKind: l.kind })),
  ];
  if (certs.length > 0) rows.push({ kind: 'certs', key: 'certs', certs });
  return rows;
}

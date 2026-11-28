import { describe, expect, it } from 'vitest';
import type { EcoFactLine } from '../eco/facts';
import { PDP_HIGHLIGHTS_MAX, benefitLines, pdpDescriptionLead, pdpHighlights } from './pdp-highlights';

const eco = (kind: EcoFactLine['kind'], text = `eco ${kind}`): EcoFactLine => ({ kind, text, sourceUrl: 'https://pannature.org/x', sourceHost: 'pannature.org' });

describe('benefitLines', () => {
  it('mỗi dòng một ý, bỏ dấu đầu dòng', () => {
    expect(benefitLines('• Sạch dầu mỡ\n- Không hại da tay\n\n✔ Hương sả chanh')).toEqual(['Sạch dầu mỡ', 'Không hại da tay', 'Hương sả chanh']);
  });
  it('một dòng nhiều câu thì tách theo câu', () => {
    expect(benefitLines('Sạch dầu mỡ. Không hại da tay! Hương sả.')).toEqual(['Sạch dầu mỡ.', 'Không hại da tay!', 'Hương sả.']);
  });
  it('không tách số thập phân, chữ viết tắt hoa (TP., Q.) hay câu viết thường', () => {
    expect(benefitLines('Nồng độ 2.5% dịu nhẹ. vẫn sạch')).toEqual(['Nồng độ 2.5% dịu nhẹ. vẫn sạch']);
    expect(benefitLines('Làm tại TP. Hồ Chí Minh. Không hại da tay.')).toEqual(['Làm tại TP. Hồ Chí Minh.', 'Không hại da tay.']);
    expect(benefitLines('Xưởng ở Q. Bình Thạnh (TP. HCM). Hương sả.')).toEqual(['Xưởng ở Q. Bình Thạnh (TP. HCM).', 'Hương sả.']);
  });
  it('rỗng', () => {
    expect(benefitLines(null)).toEqual([]);
    expect(benefitLines('  \n ')).toEqual([]);
  });
});

describe('pdpHighlights', () => {
  it('không bao giờ quá 3 dòng; chứng nhận gom một dòng chip ở cuối', () => {
    const rows = pdpHighlights({ benefit: 'A\nB\nC\nD', certifications: ['Ecocert', 'Vegan'], eco: [eco('REFILL_PACK'), eco('PLASTIC_AVOIDED')] });
    expect(rows.length).toBeLessThanOrEqual(PDP_HIGHLIGHTS_MAX);
    expect(rows.map((r) => r.kind)).toEqual(['benefit', 'eco', 'certs']);
    expect(rows[2]).toEqual({ kind: 'certs', key: 'certs', certs: ['Ecocert', 'Vegan'] });
  });
  it('chỉ mô tả ngắn: tối đa 3 ý', () => {
    expect(pdpHighlights({ benefit: 'A\nB\nC\nD', certifications: [], eco: [] }).map((r) => (r.kind === 'benefit' ? r.text : ''))).toEqual(['A', 'B', 'C']);
  });
  it('một ý lợi ích, nhiều Điểm cộng xanh: Điểm cộng xanh lấp chỗ còn lại', () => {
    const rows = pdpHighlights({ benefit: 'A', certifications: null, eco: [eco('REFILL_PACK'), eco('PLASTIC_AVOIDED'), eco('RETURNABLE_PACKAGING')] });
    expect(rows.map((r) => r.key)).toEqual(['benefit-0', 'eco-REFILL_PACK', 'eco-PLASTIC_AVOIDED']);
    const e = rows[1]!;
    expect(e.kind === 'eco' && e.sourceHost).toBe('pannature.org');
  });
  it('không có gì: không dòng nào', () => {
    expect(pdpHighlights({ benefit: '', certifications: [' '], eco: [] })).toEqual([]);
  });
});

describe('pdpDescriptionLead', () => {
  it('mô tả ngắn nhiều ý (có thể bị Điểm nổi bật cắt): trả nguyên văn cho dòng Mô tả chi tiết', () => {
    const text = '• Sạch dầu mỡ\n• Không hại da tay\n• Hương sả chanh\n• Bọt mịn';
    expect(pdpDescriptionLead(text)).toBe(text);
    expect(pdpDescriptionLead('  Sạch dầu mỡ. Không hại da tay.  ')).toBe('Sạch dầu mỡ. Không hại da tay.');
  });
  it('một ý hay rỗng: không lặp', () => {
    expect(pdpDescriptionLead('Sạch dầu mỡ, không hại da tay')).toBeNull();
    expect(pdpDescriptionLead('Làm tại TP. Hồ Chí Minh')).toBeNull();
    expect(pdpDescriptionLead('   ')).toBeNull();
    expect(pdpDescriptionLead(null)).toBeNull();
  });
});

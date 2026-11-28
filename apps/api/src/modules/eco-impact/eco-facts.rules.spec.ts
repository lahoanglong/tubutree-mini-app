import { readFileSync } from 'fs';
import { join } from 'path';
import { CSV_MAX_ROWS, csvRecords, parseCsv, parseEcoFactInput } from './eco-facts.input';
import { approvalBlockers, cardFacts, factClaims, factsForVariation, httpsSourceUrl, isInternalSheetUrl, sourceKindOf, type FactRow } from './eco-facts.rules';

const row = (over: Partial<FactRow> = {}): FactRow => ({
  kind: 'REFILL_PACK',
  variationId: null,
  valueGrams: null,
  baselineText: null,
  label: null,
  co2Grams: null,
  sourceUrl: 'https://pannature.org/a',
  ...over,
});

const draft = { kind: 'REFILL_PACK', valueGrams: null, baselineText: null, label: null, sourceUrl: 'https://pannature.org/a', sourceNote: 'Trang 3, bảng 2' };

describe('factsForVariation', () => {
  it('dòng phân loại chỉ áp cho đúng phân loại và thắng dòng cả sản phẩm cùng loại; trả theo thứ tự loại', () => {
    const rows = [row({ kind: 'PLASTIC_AVOIDED', valueGrams: 100 }), row({ kind: 'PLASTIC_AVOIDED', valueGrams: 900, variationId: 'v2' }), row({ kind: 'REFILL_PACK', variationId: 'v2' })];
    expect(factsForVariation(rows, 'v1').map((r) => r.valueGrams)).toEqual([100]);
    expect(factsForVariation(rows, 'v2').map((r) => [r.kind, r.valueGrams])).toEqual([
      ['REFILL_PACK', null],
      ['PLASTIC_AVOIDED', 900],
    ]);
    expect(factsForVariation(rows, null)).toHaveLength(1);
  });
});

describe('cardFacts', () => {
  it('bỏ vùng nguyên liệu (chỉ ở trang sản phẩm), không kèm link', () => {
    const out = cardFacts([row({ kind: 'INGREDIENT_ORIGIN', label: 'Đà Lạt' }), row({ kind: 'CERTIFICATION', label: 'Ecocert' })], null);
    expect(out).toEqual([{ kind: 'CERTIFICATION', valueGrams: null, label: 'Ecocert' }]);
  });
});

describe('httpsSourceUrl', () => {
  it('chỉ https có tên miền, không user:pass, không quá dài', () => {
    expect(httpsSourceUrl(' https://pannature.org/bao-cao ')).toBe('https://pannature.org/bao-cao');
    for (const bad of ['http://pannature.org', 'javascript:alert(1)', 'https://user:pw@x.org', 'https://localhost/a', '', 42, `https://x.org/${'a'.repeat(500)}`]) {
      expect(httpsSourceUrl(bad)).toBeNull();
    }
  });
});

describe('approvalBlockers và factClaims', () => {
  it('đủ nguồn https và ghi chú thì duyệt được', () => {
    expect(approvalBlockers(draft)).toEqual([]);
  });
  it('thiếu nguồn, ghi chú, số gam (Giảm nhựa), chữ (giấy tờ) đều chặn', () => {
    expect(approvalBlockers({ ...draft, sourceUrl: 'http://x.org', sourceNote: '  ' })).toEqual(['source_url', 'source_note']);
    expect(approvalBlockers({ ...draft, kind: 'PLASTIC_AVOIDED', valueGrams: null })).toEqual(['value_grams']);
    expect(approvalBlockers({ ...draft, kind: 'CERTIFICATION', label: ' ' })).toEqual(['label']);
    expect(approvalBlockers({ ...draft, kind: 'INGREDIENT_ORIGIN', label: null })).toEqual(['label']);
  });
  it('mốc so sánh hay chữ có tuyên bố y tế/"tự nhiên" bị chặn; tên giấy tờ được nêu ở loại giấy tờ', () => {
    expect(factClaims({ kind: 'PLASTIC_AVOIDED', baselineText: 'so với chai thường, an toàn cho da', label: null }).length).toBeGreaterThan(0);
    expect(factClaims({ kind: 'CERTIFICATION', baselineText: null, label: 'Chứng nhận Ecocert' })).toEqual([]);
    expect(factClaims({ kind: 'REFILL_PACK', baselineText: null, label: 'Chứng nhận Ecocert' })).toContain('proof');
    expect(approvalBlockers({ ...draft, kind: 'CERTIFICATION', label: '100% tự nhiên' })).toContain('claims');
  });
});

describe('parseEcoFactInput', () => {
  const base = { productSlug: 'nuoc-giat-refill', kind: 'plastic_avoided', valueGrams: '1200', sourceUrl: 'https://x.org/a', sourceNote: 'Bảng 1' };
  it('chuẩn hoá loại, số gam chữ số, khoảng trắng; 0 gam là trống', () => {
    const p = parseEcoFactInput({ ...base, baselineText: '  so với   20 chai ' });
    expect(p).toMatchObject({ ok: true, value: { kind: 'PLASTIC_AVOIDED', valueGrams: 1200, baselineText: 'so với 20 chai', variationSku: null } });
    expect(parseEcoFactInput({ ...base, valueGrams: 0 })).toMatchObject({ ok: true, value: { valueGrams: null } });
  });
  it('lỗi nói đúng trường', () => {
    expect(parseEcoFactInput(null)).toEqual({ ok: false, error: 'Thiếu dữ liệu.' });
    expect(parseEcoFactInput({ ...base, productSlug: ' ' })).toMatchObject({ ok: false, error: 'Thiếu mã sản phẩm (slug).' });
    expect(parseEcoFactInput({ ...base, kind: 'BAMBOO' })).toMatchObject({ ok: false, error: 'Loại sự thật không có trong danh sách.' });
    expect(parseEcoFactInput({ ...base, valueGrams: '1,5' })).toMatchObject({ ok: false });
    expect(parseEcoFactInput({ ...base, valueGrams: -1 })).toMatchObject({ ok: false });
    expect(parseEcoFactInput({ ...base, kind: 'REFILL_PACK' })).toMatchObject({ ok: false, error: 'Số gam nhựa chỉ dùng cho loại Giảm nhựa.' });
    expect(parseEcoFactInput({ ...base, label: 'x'.repeat(81) })).toMatchObject({ ok: false, error: 'Chữ hiển thị dài quá 80 ký tự.' });
  });
  it('nháp thiếu nguồn vẫn lưu được (duyệt mới chặn)', () => {
    expect(parseEcoFactInput({ productSlug: 'a', kind: 'REFILL_PACK' })).toMatchObject({ ok: true, value: { sourceUrl: '', sourceNote: '' } });
  });
});

describe('CSV', () => {
  it('RFC 4180: ngoặc kép, dấu phẩy và xuống dòng trong ngoặc, BOM, CRLF, dòng trống', () => {
    const csv = '﻿productSlug,kind,baselineText\r\na,REFILL_PACK,"so với ""chai"", 500ml"\r\n\r\nb,CERTIFICATION,"hai\ndòng"\n';
    expect(parseCsv(csv)).toEqual([
      ['productSlug', 'kind', 'baselineText'],
      ['a', 'REFILL_PACK', 'so với "chai", 500ml'],
      ['b', 'CERTIFICATION', 'hai\ndòng'],
    ]);
  });
  it('dòng theo tiêu đề, số dòng tính từ tệp; thiếu cột bắt buộc hay quá nhiều dòng thì lỗi', () => {
    const ok = csvRecords('productSlug,kind,extra\na,REFILL_PACK,x\n');
    expect(ok).toEqual({ ok: true, records: [{ line: 2, data: { productSlug: 'a', kind: 'REFILL_PACK', extra: 'x' } }] });
    expect(csvRecords('slug,kind\na,b')).toMatchObject({ ok: false });
    expect(csvRecords('')).toEqual({ ok: false, error: 'Tệp CSV trống.' });
    const many = ['productSlug,kind', ...Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `p${i},REFILL_PACK`)].join('\n');
    expect(csvRecords(many)).toMatchObject({ ok: false });
  });
});

describe('docs/eco/eco-facts-draft.csv', () => {
  it('nhập được bằng chính bộ đọc CSV của admin; chưa có số, chưa có nguồn nên mọi dòng vào Nháp và chưa duyệt được', () => {
    const csv = readFileSync(join(__dirname, '../../../../../docs/eco/eco-facts-draft.csv'), 'utf8');
    const parsed = csvRecords(csv);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.records.length).toBeGreaterThan(0);
    for (const r of parsed.records) {
      const input = parseEcoFactInput(r.data);
      if (!input.ok) throw new Error(`dòng ${r.line}: ${input.error}`);
      expect(input.value).toMatchObject({ valueGrams: null, co2Grams: null, sourceUrl: '' });
      expect(input.value.productSlug).toMatch(/-10l-[0-9a-f]{6}$/);
      expect(approvalBlockers(input.value).length).toBeGreaterThan(0);
    }
  });
});

describe('phiếu cân nội bộ (tubutree.com)', () => {
  it('nhận trang https ở tubutree.com / www.tubutree.com, kể cả có tham số và mốc', () => {
    expect(isInternalSheetUrl('https://tubutree.com/phieu-can/refill-10l')).toBe(true);
    expect(isInternalSheetUrl('https://www.tubutree.com/phieu-can/refill-10l/?v=2#dong-3')).toBe(true);
    expect(isInternalSheetUrl('https://TubuTree.com/phieu-can')).toBe(true);
  });

  it('từ chối http, trang chủ, tên miền giả, tên miền con khác, user:pass, cổng lạ, rác', () => {
    for (const u of [
      'http://tubutree.com/phieu-can',
      'https://tubutree.com',
      'https://tubutree.com/',
      'https://tubutree.com.evil.org/phieu-can',
      'https://evil.org/https://tubutree.com/phieu-can',
      'https://nottubutree.com/phieu-can',
      'https://cdn.tubutree.com/phieu-can',
      'https://user:pw@tubutree.com/phieu-can',
      'https://tubutree.com:8443/phieu-can',
      'javascript:alert(1)',
      '',
      null,
      42,
    ]) {
      expect(isInternalSheetUrl(u)).toBe(false);
    }
  });

  it('sourceKindOf: nội bộ / ngoài / chưa có link', () => {
    expect(sourceKindOf('https://tubutree.com/phieu-can/a')).toBe('internal_sheet');
    expect(sourceKindOf('https://pannature.org/a')).toBe('external');
    expect(sourceKindOf('')).toBeNull();
    expect(sourceKindOf('http://pannature.org/a')).toBeNull();
  });

  it('link phiếu cân nội bộ qua được blocker source_url; Giảm nhựa vẫn bị chặn tới khi có số gam', () => {
    const base = { kind: 'PLASTIC_AVOIDED', valueGrams: null, baselineText: null, label: null, sourceUrl: 'https://tubutree.com/phieu-can/a', sourceNote: 'Dòng 3' };
    expect(approvalBlockers(base)).toEqual(['value_grams']);
    expect(approvalBlockers({ ...base, valueGrams: 640 })).toEqual([]);
    expect(approvalBlockers({ ...base, kind: 'REFILL_PACK' })).toEqual([]);
  });
});

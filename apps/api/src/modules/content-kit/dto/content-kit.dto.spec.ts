import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertContentKitDto } from './content-kit.dto';

async function keys(plain: Record<string, unknown>) {
  const errs = await validate(plainToInstance(UpsertContentKitDto, plain), { whitelist: true, forbidNonWhitelisted: true });
  const flat = (e: (typeof errs)[number]): string[] => [
    ...Object.keys(e.constraints ?? {}).map((k) => `${e.property}.${k}`),
    ...(e.children ?? []).flatMap(flat).map((k) => `${e.property}.${k}`),
  ];
  return errs.flatMap(flat);
}

describe('UpsertContentKitDto.faqs', () => {
  const faq = { q: 'Dùng thế nào?', a: 'Pha 1 muỗng với nước ấm.' };

  it('mảng {q,a} hợp lệ qua; bỏ trống faqs vẫn qua', async () => {
    expect(await keys({ faqs: [faq] })).toEqual([]);
    expect(await keys({})).toEqual([]);
    expect(await keys({ faqs: [] })).toEqual([]);
  });

  it('q đúng 300 qua, 301 báo lỗi; a đúng 2000 qua, 2001 báo lỗi', async () => {
    expect(await keys({ faqs: [{ q: 'q'.repeat(300), a: 'a'.repeat(2000) }] })).toEqual([]);
    expect(await keys({ faqs: [{ q: 'q'.repeat(301), a: 'a' }] })).toEqual(expect.arrayContaining([expect.stringContaining('q.maxLength')]));
    expect(await keys({ faqs: [{ q: 'q', a: 'a'.repeat(2001) }] })).toEqual(expect.arrayContaining([expect.stringContaining('a.maxLength')]));
  });

  it('q hoặc a rỗng sau khi cắt (khoảng trắng, U+200B) báo isNotEmpty', async () => {
    expect(await keys({ faqs: [{ q: '  \u200b', a: 'a' }] })).toEqual(expect.arrayContaining([expect.stringContaining('q.isNotEmpty')]));
    expect(await keys({ faqs: [{ q: 'q', a: '\u00a0' }] })).toEqual(expect.arrayContaining([expect.stringContaining('a.isNotEmpty')]));
  });

  it('q/a được cắt hai đầu trước khi đếm trần', async () => {
    const dto = plainToInstance(UpsertContentKitDto, { faqs: [{ q: ` ${'q'.repeat(300)} `, a: '\u200bđáp\u200b' }] });
    expect(dto.faqs?.[0]).toEqual({ q: 'q'.repeat(300), a: 'đáp' });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('quá 20 mục báo arrayMaxSize; phần tử không phải object và thiếu trường báo lỗi; trường lạ bị chặn', async () => {
    expect(await keys({ faqs: Array(20).fill(faq) })).toEqual([]);
    expect(await keys({ faqs: Array(21).fill(faq) })).toContain('faqs.arrayMaxSize');
    expect((await keys({ faqs: ['hỏi đáp'] })).length).toBeGreaterThan(0);
    expect((await keys({ faqs: [null] })).length).toBeGreaterThan(0);
    expect((await keys({ faqs: [{ q: 'chỉ có hỏi' }] })).length).toBeGreaterThan(0);
    expect((await keys({ faqs: [{ ...faq, html: '<b>x</b>' }] })).length).toBeGreaterThan(0);
  });

  it('captions, usps, videoUrls cắt từng phần tử trước khi kiểm trần', async () => {
    const dto = plainToInstance(UpsertContentKitDto, { captions: [' a\u200b'], usps: ['\u200bb '], videoUrls: [` ${'v'.repeat(500)}\n`] });
    expect(dto.captions).toEqual(['a']);
    expect(dto.usps).toEqual(['b']);
    expect(dto.videoUrls).toEqual(['v'.repeat(500)]);
    expect(await validate(dto)).toEqual([]);
  });
});

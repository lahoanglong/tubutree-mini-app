import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBrandDto, UpdateBrandDto } from './brand.dto';

async function keys<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  const flat = (e: (typeof errs)[number]): string[] => [
    ...Object.keys(e.constraints ?? {}).map((k) => `${e.property}.${k}`),
    ...(e.children ?? []).flatMap(flat).map((k) => `${e.property}.${k}`),
  ];
  return errs.flatMap(flat);
}

describe.each([
  ['CreateBrandDto', CreateBrandDto, { name: 'Tubu' }],
  ['UpdateBrandDto', UpdateBrandDto, {}],
] as const)('%s.certifications', (_label, cls, base) => {
  const cert = { code: 'ORG', label: 'Hữu cơ USDA', verified: true, proofUrl: 'https://tubu.vn/proof/org.pdf' };
  const run = (certifications: unknown) => keys(cls as new () => object, { ...base, certifications });

  it('hình dạng admin đang gửi (code, label, verified, proofUrl) qua; thiếu verified/proofUrl vẫn qua', async () => {
    expect(await run([cert])).toEqual([]);
    expect(await run([{ code: 'ORG', label: 'Hữu cơ' }])).toEqual([]);
    expect(await run([{ ...cert, proofUrl: '' }])).toEqual([]);
    expect(await run([])).toEqual([]);
  });

  it('bỏ trống qua; null qua ở tạo nhãn, bị chặn ở sửa nhãn (Prisma không nhận null cho cột Json)', async () => {
    expect(await keys(cls as new () => object, { ...base })).toEqual([]);
    if (cls === UpdateBrandDto) expect(await run(null)).toContain('certifications.optionalNotNull');
    else expect(await run(null)).toEqual([]);
  });

  it('quá 20 mục báo arrayMaxSize, đúng 20 qua', async () => {
    expect(await run(Array(20).fill(cert))).toEqual([]);
    expect(await run(Array(21).fill(cert))).toContain('certifications.arrayMaxSize');
  });

  it('mỗi trường có trần: code 40, label 200, proofUrl 500', async () => {
    expect(await run([{ code: 'c'.repeat(40), label: 'l'.repeat(200), proofUrl: 'p'.repeat(500) }])).toEqual([]);
    expect(await run([{ ...cert, code: 'c'.repeat(41) }])).toEqual(expect.arrayContaining([expect.stringContaining('code.maxLength')]));
    expect(await run([{ ...cert, label: 'l'.repeat(201) }])).toEqual(expect.arrayContaining([expect.stringContaining('label.maxLength')]));
    expect(await run([{ ...cert, proofUrl: 'p'.repeat(501) }])).toEqual(expect.arrayContaining([expect.stringContaining('proofUrl.maxLength')]));
  });

  it('code/label rỗng sau khi cắt (khoảng trắng, U+200B) báo isNotEmpty; được cắt hai đầu', async () => {
    expect(await run([{ ...cert, code: ' \u200b' }])).toEqual(expect.arrayContaining([expect.stringContaining('code.isNotEmpty')]));
    expect(await run([{ ...cert, label: '\u00a0' }])).toEqual(expect.arrayContaining([expect.stringContaining('label.isNotEmpty')]));
    const dto = plainToInstance(cls as new () => { certifications?: { code: string }[] }, { ...base, certifications: [{ ...cert, code: ' ORG\u200b' }] });
    expect(dto.certifications?.[0]?.code).toBe('ORG');
  });

  it('không phải mảng object: chuỗi, mảng chuỗi, số, null trong mảng, trường lạ đều báo lỗi', async () => {
    expect((await run('ORG')).length).toBeGreaterThan(0);
    expect((await run(['ORG'])).length).toBeGreaterThan(0);
    expect((await run(5)).length).toBeGreaterThan(0);
    expect((await run([null])).length).toBeGreaterThan(0);
    expect((await run([{ ...cert, extra: 1 }])).length).toBeGreaterThan(0);
    expect((await run([{ code: 'ORG' }])).length).toBeGreaterThan(0);
    expect((await run([{ ...cert, verified: 'yes' }])).length).toBeGreaterThan(0);
  });
});

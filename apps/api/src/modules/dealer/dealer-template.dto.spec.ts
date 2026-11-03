import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SaveTemplateDto } from './dealer.controller';

const item = { variationId: 'v1', quantity: 1 };
const keysFor = async (plain: Record<string, unknown>) => {
  const errs = await validate(plainToInstance(SaveTemplateDto, plain));
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
};

// BAOMAT-10: tên mẫu và số dòng không có trần, một đại lý lưu được mẫu nặng cả MB.
describe('SaveTemplateDto', () => {
  it('mẫu bình thường hợp lệ, tới 120 ký tự tên và 100 dòng', async () => {
    expect(await keysFor({ name: 'Đơn tuần', items: [item] })).toEqual([]);
    expect(await keysFor({ name: 'x'.repeat(120), items: Array(100).fill(item) })).toEqual([]);
  });
  it('tên dài hơn 120 ký tự → maxLength', async () => {
    expect(await keysFor({ name: 'x'.repeat(121), items: [item] })).toContain('maxLength');
  });
  it('hơn 100 dòng → arrayMaxSize', async () => {
    expect(await keysFor({ name: 'Đơn', items: Array(101).fill(item) })).toContain('arrayMaxSize');
  });
});

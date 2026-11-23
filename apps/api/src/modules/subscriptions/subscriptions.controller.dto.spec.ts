import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { SkipSubDto, UpdateSubDto } from './subscriptions.controller';

const pipe = createValidationPipe();
const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: UpdateSubDto }) as Promise<UpdateSubDto>;

describe('DTO sửa gói định kỳ: chu kỳ giao (Q22)', () => {
  it.each([4, 6, 8, 10])('nhận chu kỳ %i tuần', async (weeks) => {
    await expect(run({ intervalWeeks: weeks })).resolves.toMatchObject({ intervalWeeks: weeks });
  });

  it.each([5, 0, 12, '6', null, 4.5])('từ chối chu kỳ %p bằng 400 nêu nhãn tiếng Việt, không lộ tên trường', async (bad) => {
    const err = await run({ intervalWeeks: bad }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toMatch(/Chu kỳ giao/);
  });

  it('400 không lộ tên trường thô intervalWeeks cho khách', async () => {
    const err = await run({ intervalWeeks: 5 }).catch((e: unknown) => e);
    expect(JSON.stringify((err as BadRequestException).getResponse())).not.toMatch(/intervalWeeks/);
  });

  it('chu kỳ không bắt buộc: chỉ sửa số lượng vẫn qua', async () => {
    await expect(run({ quantity: 3 })).resolves.toMatchObject({ quantity: 3 });
  });
});

describe('DTO sửa gói định kỳ: dời ngày giao kỳ tới', () => {
  it('nhận YYYY-MM-DD', async () => {
    await expect(run({ nextRunDate: '2026-12-01' })).resolves.toMatchObject({ nextRunDate: '2026-12-01' });
  });

  it.each(['01/12/2026', '2026-12-1', 20261201, null])('từ chối %p bằng 400 nêu nhãn tiếng Việt, không lộ tên trường', async (bad) => {
    const err = await run({ nextRunDate: bad }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = JSON.stringify((err as BadRequestException).getResponse());
    expect(body).toMatch(/Ngày giao kỳ tới/);
    expect(body).not.toMatch(/nextRunDate/);
  });
});

describe('DTO sửa gói định kỳ: ngày đang hiện (expectedNextRunAt)', () => {
  it('nhận ISO đầy đủ như GET trả', async () => {
    await expect(run({ nextRunDate: '2026-12-01', expectedNextRunAt: '2026-11-24T17:00:00.000Z' })).resolves.toMatchObject({
      expectedNextRunAt: '2026-11-24T17:00:00.000Z',
    });
  });

  it.each(['24/11/2026', 'hôm qua', 1764003600000, null])('từ chối %p bằng 400', async (bad) => {
    const err = await run({ nextRunDate: '2026-12-01', expectedNextRunAt: bad }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('DTO bỏ qua kỳ: "Lần kế" đang hiện (expectedNextRunAt)', () => {
  const runSkip = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SkipSubDto }) as Promise<SkipSubDto>;

  it('nhận ISO đầy đủ như GET trả', async () => {
    await expect(runSkip({ expectedNextRunAt: '2026-11-24T17:00:00.000Z' })).resolves.toMatchObject({ expectedNextRunAt: '2026-11-24T17:00:00.000Z' });
  });

  it('bỏ trống (ZMP cũ gửi skip không thân) thì DTO cho qua', async () => {
    await expect(runSkip({})).resolves.toMatchObject({});
  });

  it.each(['24/11/2026', 'hôm qua', 1764003600000, null])('từ chối %p bằng 400', async (bad) => {
    const err = await runSkip({ expectedNextRunAt: bad }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

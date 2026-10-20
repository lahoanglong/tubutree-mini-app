import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { UpdateSubDto } from './subscriptions.controller';

const pipe = createValidationPipe();
const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: UpdateSubDto }) as Promise<UpdateSubDto>;

describe('DTO sửa gói định kỳ: chu kỳ giao (Q22)', () => {
  it.each([4, 6, 8, 10])('nhận chu kỳ %i tuần', async (weeks) => {
    await expect(run({ intervalWeeks: weeks })).resolves.toMatchObject({ intervalWeeks: weeks });
  });

  it.each([5, 0, 12, '6', null, 4.5])('từ chối chu kỳ %p bằng 400 nêu đúng trường', async (bad) => {
    const err = await run({ intervalWeeks: bad }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toMatch(/«intervalWeeks»/);
  });

  it('chu kỳ không bắt buộc: chỉ sửa số lượng vẫn qua', async () => {
    await expect(run({ quantity: 3 })).resolves.toMatchObject({ quantity: 3 });
  });
});

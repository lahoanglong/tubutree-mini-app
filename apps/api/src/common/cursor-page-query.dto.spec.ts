import { ValidationPipe } from '@nestjs/common';
import { CursorPageQuery } from './cursor-page-query.dto';

// Cùng cấu hình ValidationPipe với main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const as = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype: CursorPageQuery, data: undefined });

describe('CursorPageQuery: cursor/take từ query string', () => {
  it('giá trị hợp lệ client đang gửi vẫn chạy', async () => {
    await expect(as({ cursor: 'ckabc123', take: '20' })).resolves.toMatchObject({ cursor: 'ckabc123', take: '20' });
    await expect(as({ take: '20' })).resolves.toMatchObject({ take: '20' });
    await expect(as({})).resolves.toEqual({});
  });

  it('tham số rỗng coi như không gửi (controller cũ dùng `take ?` / `cursor ||`)', async () => {
    const r = (await as({ cursor: '', take: '' })) as CursorPageQuery;
    expect(r.cursor).toBeUndefined();
    expect(r.take).toBeUndefined();
  });

  it('take không phải số → 400 (trước đây NaN vào take của Prisma → 500)', async () => {
    for (const take of ['abc', 'NaN', '1,5', '0x10', ['1', '2'], { a: '1' }]) {
      await expect(as({ take })).rejects.toThrow();
    }
  });

  it('take chỉ nhận số nguyên dương tối đa 4 chữ số (clamp ở service lo phần còn lại)', async () => {
    for (const take of ['1', '20', '200', '9999']) {
      await expect(as({ take })).resolves.toMatchObject({ take });
    }
    for (const take of ['1.5', '-1', '-5', '0', '1e3', '10000', '007', '+5', ' 5', '999999999999999999999999999']) {
      await expect(as({ take })).rejects.toThrow();
    }
  });

  it('cursor mảng/object → 400 (trước đây Prisma ném validation error → 500)', async () => {
    await expect(as({ cursor: ['a', 'b'] })).rejects.toThrow();
    await expect(as({ cursor: { a: 'b' } })).rejects.toThrow();
  });

  it('query lạ vẫn bị 400', async () => {
    await expect(as({ foo: 'x' })).rejects.toThrow();
  });
});

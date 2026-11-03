import { readFileSync } from 'fs';
import { join } from 'path';
import { CronAwareLogger, firstLogLine } from './cron-aware-logger';

describe('firstLogLine', () => {
  it('chuỗi: dòng đầu có chữ; Error: tên lớp + dòng đầu; khác: chỉ kiểu', () => {
    expect(firstLogLine('\n  a\nb')).toBe('a');
    expect(firstLogLine(new TypeError('x\ny'))).toBe('TypeError: x');
    expect(firstLogLine({ token: 't' })).toBe('object');
  });

  it('lỗi Prisma: bỏ dòng "Invalid ... invocation" và khung mã, giữ câu lỗi thật; không kèm stack', () => {
    const minimal = '\nInvalid `prisma.$executeRaw()` invocation:\n\n\nRaw query failed. Code: `42703`. Message: `column "id" does not exist`';
    expect(firstLogLine(`Dọn support_chat lỗi: ${minimal}`)).toBe(
      'Dọn support_chat lỗi: Raw query failed. Code: `42703`. Message: `column "id" does not exist`',
    );
    const pretty =
      '\nInvalid `this.prisma.order.update()` invocation in\n/app/dist/x.js:12:3\n\n  9 \n→ 12 await this.prisma.order.update(\n\nRecord to update not found.';
    expect(firstLogLine(`PrismaClientKnownRequestError: ${pretty}\n    at a (x.js:1:1)\n    at b (y.js:2:2)`)).toBe(
      'PrismaClientKnownRequestError: Record to update not found.',
    );
    expect(firstLogLine(new Error(minimal))).toBe('Error: Raw query failed. Code: `42703`. Message: `column "id" does not exist`');
  });
});

describe('CronAwareLogger', () => {
  it('là ConsoleLogger: vẫn in log error ra như thường', () => {
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    new CronAwareLogger().error('hỏng', undefined, 'Ctx');
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });

  it('bootstrap dùng nó làm logger mặc định của app', () => {
    expect(readFileSync(join(__dirname, '..', '..', 'bootstrap.ts'), 'utf8')).toContain('opts.logger ?? new CronAwareLogger()');
  });
});

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
      '\nInvalid `this.prisma.user.update()` invocation in\n/app/dist/x.js:12:3\n\n  9 \n→ 12 await this.prisma.user.update({\n  where: {\n    phone: "0901234567"\n  }\n})\n\nRecord to update not found.';
    expect(firstLogLine(`PrismaClientKnownRequestError: ${pretty}\n    at a (x.js:1:1)\n    at b (y.js:2:2)`)).toBe(
      'PrismaClientKnownRequestError: Record to update not found.',
    );
    expect(firstLogLine(new Error(minimal))).toBe('Error: Raw query failed. Code: `42703`. Message: `column "id" does not exist`');
    const unreachable = '\nInvalid `prisma.user.findMany()` invocation:\n\n\nCan\'t reach database server at `db:5432`\n\nPlease make sure your database server is running at `db:5432`.';
    expect(firstLogLine(new Error(unreachable))).toBe("Error: Can't reach database server at `db:5432`");
  });

  it('không đưa giá trị dòng/khoá vi phạm (SĐT, tên) của Postgres vào dòng lỗi', () => {
    const raw = (msg: string) => new Error(`\nInvalid \`prisma.$executeRaw()\` invocation:\n\n\n${msg}`);
    expect(
      firstLogLine(
        raw('Raw query failed. Code: `23514`. Message: `ERROR: new row for relation "users" violates check constraint "users_coins_frozen"\nDETAIL: Failing row contains (cmw0, z1, null, null, 0901234567, a@b.c, Nguyen Van A)`'),
      ),
    ).toBe('Error: Raw query failed. Code: `23514`. Message: `ERROR: new row for relation "users" violates check constraint "users_coins_frozen"');
    expect(firstLogLine(raw('Raw query failed. Code: `23502`. Message: `Failing row contains (0901234567, Nguyen Van A, 1, null).`'))).toBe(
      'Error: Raw query failed. Code: `23502`. Message: `…',
    );
    expect(firstLogLine(raw('Raw query failed. Code: `23505`. Message: `Key (phone)=(0901234567) already exists.`'))).toBe(
      'Error: Raw query failed. Code: `23505`. Message: `…',
    );
    const orm = raw('Error occurred during query execution:\nConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "23514", detail: Some("Failing row contains (0901234567)") }) })');
    expect(firstLogLine(orm)).toBe('Error: Error occurred during query execution:');
    expect(firstLogLine('Dọn lỗi: Key (phone)=(0901234567) already exists.')).toBe('Dọn lỗi: …');
    expect(firstLogLine('Đồng bộ lỗi: ghi chú\nInvalid `x` invocation: 0901234567\nchi tiết')).toBe('Đồng bộ lỗi: ghi chú');
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

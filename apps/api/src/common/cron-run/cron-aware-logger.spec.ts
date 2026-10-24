import { readFileSync } from 'fs';
import { join } from 'path';
import { CronAwareLogger, firstLogLine } from './cron-aware-logger';

describe('firstLogLine', () => {
  it('chuỗi: dòng đầu có chữ; Error: tên lớp + dòng đầu; khác: chỉ kiểu', () => {
    expect(firstLogLine('\n  a\nb')).toBe('a');
    expect(firstLogLine(new TypeError('x\ny'))).toBe('TypeError: x');
    expect(firstLogLine({ token: 't' })).toBe('object');
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

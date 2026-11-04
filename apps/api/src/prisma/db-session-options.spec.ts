import { buildDatasourceUrl, parseDbSessionOptions, pgDurationToMs } from './db-session-options';

const OPTS = '-c statement_timeout=30s -c lock_timeout=10s -c idle_in_transaction_session_timeout=30s';

describe('buildDatasourceUrl', () => {
  it('không đặt DB_SESSION_OPTIONS → undefined (PrismaClient dùng DATABASE_URL trơn)', () => {
    expect(buildDatasourceUrl('postgresql://u:p@db:5432/x', undefined)).toBeUndefined();
    expect(buildDatasourceUrl('postgresql://u:p@db:5432/x', '')).toBeUndefined();
    expect(buildDatasourceUrl('postgresql://u:p@db:5432/x', '   ')).toBeUndefined();
  });

  it('URL không có query → nối bằng ?', () => {
    expect(buildDatasourceUrl('postgresql://u:p@db:5432/x', OPTS)).toBe(
      'postgresql://u:p@db:5432/x?options=-c%20statement_timeout%3D30s%20-c%20lock_timeout%3D10s%20-c%20idle_in_transaction_session_timeout%3D30s',
    );
  });

  it('URL đã có query → nối bằng &, giữ nguyên tham số cũ', () => {
    const url = buildDatasourceUrl('postgresql://u:p@db:5432/x?schema=public&connection_limit=20', '-c lock_timeout=10s');
    expect(url).toBe('postgresql://u:p@db:5432/x?schema=public&connection_limit=20&options=-c%20lock_timeout%3D10s');
  });

  it('khoảng trắng thành %20 và dấu = thành %3D (giải mã ngược ra đúng chuỗi gốc)', () => {
    const url = buildDatasourceUrl('postgresql://u:p@db/x', OPTS) as string;
    expect(url).not.toMatch(/options=[^&]*[ =]/);
    expect(decodeURIComponent(url.split('options=')[1] ?? '')).toBe(OPTS);
  });

  it('DATABASE_URL đã có options= và DB_SESSION_OPTIONS cũng đặt → lỗi rõ ràng', () => {
    expect(() => buildDatasourceUrl('postgresql://u:p@db/x?options=-c%20lock_timeout%3D1s', OPTS)).toThrow(/options=/);
    expect(() => buildDatasourceUrl('postgresql://u:p@db/x?schema=a&options=x', OPTS)).toThrow(/DB_SESSION_OPTIONS/);
  });

  it('DATABASE_URL có options= mà DB_SESSION_OPTIONS không đặt → để yên', () => {
    expect(buildDatasourceUrl('postgresql://u:p@db/x?options=-c%20lock_timeout%3D1s', undefined)).toBeUndefined();
  });

  it('chuỗi options sai → ném lỗi, không nối vào URL', () => {
    expect(() => buildDatasourceUrl('postgresql://u:p@db/x', '-c work_mem=64MB')).toThrow(/work_mem/);
  });
});

describe('parseDbSessionOptions', () => {
  it('chấp nhận ba tên cho phép với đơn vị ms, s, min hoặc số trần', () => {
    const r = parseDbSessionOptions('-c statement_timeout=500ms -c lock_timeout=2min -c idle_in_transaction_session_timeout=30000');
    expect(r).toEqual({ ok: true, settings: { statement_timeout: '500ms', lock_timeout: '2min', idle_in_transaction_session_timeout: '30000' } });
  });

  it.each([
    ['tên lạ', '-c work_mem=64MB', /work_mem/],
    ['giá trị không phải số', '-c statement_timeout=abc', /statement_timeout/],
    ['đơn vị lạ', '-c statement_timeout=30h', /statement_timeout/],
    ['thiếu -c', 'statement_timeout=30s', /-c/],
    ['thiếu giá trị', '-c statement_timeout', /statement_timeout/],
    ['trùng tên', '-c lock_timeout=1s -c lock_timeout=2s', /lock_timeout/],
    ['chèn lệnh khác', '-c statement_timeout=30s --search_path=x', /search_path/],
    ['giá trị rỗng', '-c lock_timeout=', /lock_timeout/],
  ])('từ chối %s', (_n, raw, re) => {
    const r = parseDbSessionOptions(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(re);
  });
});

describe('pgDurationToMs', () => {
  it.each([
    ['30s', 30_000],
    ['10s', 10_000],
    ['500ms', 500],
    ['2min', 120_000],
    ['1h', 3_600_000],
    ['0', 0],
    ['30000', 30_000],
  ])('%s', (v, ms) => {
    expect(pgDurationToMs(v)).toBe(ms);
  });
  it('chuỗi lạ → NaN', () => expect(pgDurationToMs('abc')).toBeNaN());
});

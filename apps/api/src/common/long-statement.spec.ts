import { LONG_STATEMENT_TIMEOUT, allowLongStatements } from './long-statement';

describe('allowLongStatements', () => {
  it('nâng statement_timeout chỉ trong transaction hiện tại (set_config local = true), không đổi phiên của kết nối', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    await allowLongStatements({ $queryRaw: queryRaw });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, value] = queryRaw.mock.calls[0] as [string[], string, string];
    expect(strings.join('?')).toMatch(/set_config\(\s*'statement_timeout'\s*,\s*\?\s*,\s*true\s*\)/);
    expect(value).toBe(LONG_STATEMENT_TIMEOUT);
  });

  it('mặc định 120s: cao hơn 30s của DATABASE_URL nhưng vẫn có trần', () => {
    expect(LONG_STATEMENT_TIMEOUT).toBe('120s');
  });
});

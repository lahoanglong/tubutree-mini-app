import { Logger } from '@nestjs/common';
import { ZnsClient } from './zns.client';

describe('ZnsClient — log không lộ SĐT khách (R2-PLATFORM-10)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('chưa cấu hình token → log bỏ qua có SĐT đã che', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = { get: () => 'http://zns.invalid' };
    const client = new ZnsClient(config as never, { getAccessToken: jest.fn().mockResolvedValue(null) } as never);
    await expect(client.sendTemplate('0910087109', 'tpl1', {})).resolves.toBe(false);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('0910087109');
    expect(logged).toContain('091****109');
  });
});

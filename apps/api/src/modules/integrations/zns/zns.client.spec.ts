import { Logger } from '@nestjs/common';
import axios from 'axios';
import { ZNS_REQUEST_TIMEOUT_MS, ZnsClient } from './zns.client';

jest.mock('axios', () => ({ ...jest.requireActual('axios'), post: jest.fn() }));

describe('ZnsClient — log không lộ SĐT khách (R2-PLATFORM-10)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('chưa cấu hình token → log bỏ qua có SĐT đã che', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = { get: () => 'http://zns.invalid' };
    const client = new ZnsClient(config as never, { getAccessToken: jest.fn().mockResolvedValue(null) } as never);
    await expect(client.sendTemplate('0910087109', 'tpl1', {})).resolves.toMatchObject({ ok: false });
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('0910087109');
    expect(logged).toContain('091****109');
  });
});

describe('ZnsClient — chờ Zalo đủ lâu và gắn tracking_id cố định (R3-UI-11)', () => {
  const make = () =>
    new ZnsClient({ get: () => 'http://zns.invalid' } as never, { getAccessToken: jest.fn().mockResolvedValue('tok') } as never);

  beforeEach(() => (axios.post as jest.Mock).mockReset().mockResolvedValue({ data: { error: 0 } }));

  it('hạn chờ 25 giây: Zalo phản hồi chậm vài chục giây không bị coi là lỗi rồi gửi lại tin thứ hai', async () => {
    await make().sendTemplate('0910087109', 'tpl1', { order_code: 'T1' }, 'log-1');
    const config = (axios.post as jest.Mock).mock.calls[0][2];
    expect(ZNS_REQUEST_TIMEOUT_MS).toBe(25_000);
    expect(config.timeout).toBe(ZNS_REQUEST_TIMEOUT_MS);
  });

  it('có tracking_id thì gửi kèm để đối soát một tin với một NotificationLog', async () => {
    await make().sendTemplate('0910087109', 'tpl1', { order_code: 'T1' }, 'log-1');
    expect((axios.post as jest.Mock).mock.calls[0][1]).toEqual({
      phone: '0910087109',
      template_id: 'tpl1',
      template_data: { order_code: 'T1' },
      tracking_id: 'log-1',
    });
  });

  it('không có tracking_id thì không thêm trường', async () => {
    await make().sendTemplate('0910087109', 'tpl1', {});
    expect((axios.post as jest.Mock).mock.calls[0][1]).not.toHaveProperty('tracking_id');
  });
});

import { VitalsIngestGate } from './vitals-ingest.gate';
import type { SystemConfigService } from '../../system-config/system-config.service';

const gateWith = (value: unknown) => {
  const get = jest.fn(async () => value);
  return { gate: new VitalsIngestGate({ get } as unknown as SystemConfigService), get };
};
const ev = (eventName: string) => ({ eventName });

describe('VitalsIngestGate', () => {
  it('cờ tắt: bỏ mọi số đo, giữ sự kiện khác', async () => {
    const { gate } = gateWith(false);
    const out = await gate.filter([ev('screen_viewed'), ev('web_vital'), ev('mini_vital'), ev('cart_viewed')]);
    expect(out.map((e) => e.eventName)).toEqual(['screen_viewed', 'cart_viewed']);
  });

  it('cờ hỏng (chuỗi "true") coi như tắt', async () => {
    const { gate } = gateWith('true');
    expect(await gate.filter([ev('web_vital')])).toEqual([]);
  });

  it('đọc cấu hình lỗi thì coi như tắt, không làm hỏng lô', async () => {
    const get = jest.fn(async () => {
      throw new Error('db down');
    });
    const gate = new VitalsIngestGate({ get } as unknown as SystemConfigService);
    expect((await gate.filter([ev('web_vital'), ev('screen_viewed')])).map((e) => e.eventName)).toEqual(['screen_viewed']);
  });

  it('lô không có số đo thì không đọc cấu hình', async () => {
    const { gate, get } = gateWith(false);
    const events = [ev('screen_viewed')];
    expect(await gate.filter(events)).toBe(events);
    expect(get).not.toHaveBeenCalled();
  });

  it('cờ bật: nhận tối đa 8 số đo một lô', async () => {
    const { gate } = gateWith(true);
    const out = await gate.filter([ev('screen_viewed'), ...Array.from({ length: 12 }, () => ev('web_vital'))]);
    expect(out.filter((e) => e.eventName === 'web_vital')).toHaveLength(8);
    expect(out[0]!.eventName).toBe('screen_viewed');
  });
});

import { SystemConfigController } from './system-config.controller';
import type { SystemConfigService } from './system-config.service';

describe('SystemConfigController.publicConfig', () => {
  it('trả freeshipThreshold từ config', async () => {
    const config = { get: jest.fn().mockResolvedValue(150000) } as unknown as SystemConfigService;
    const out = await new SystemConfigController(config).publicConfig();
    expect(out).toEqual({ freeshipThreshold: 150000 });
    expect((config as unknown as { get: jest.Mock }).get).toHaveBeenCalledWith('shipping.free_threshold', 200000);
  });

  it('dùng default 200000 khi config chưa set', async () => {
    // get() tự trả fallback khi thiếu key → controller truyền default 200000.
    const config = { get: jest.fn().mockResolvedValue(200000) } as unknown as SystemConfigService;
    const out = await new SystemConfigController(config).publicConfig();
    expect(out.freeshipThreshold).toBe(200000);
  });
});

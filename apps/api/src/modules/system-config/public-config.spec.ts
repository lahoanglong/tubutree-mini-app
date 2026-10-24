import { buildPublicConfig } from './public-config';
import { DEFAULT_CHAT_HOURS } from '../support-chat/support-chat.config';

const build = (stored: Record<string, unknown>) =>
  buildPublicConfig({ get: jest.fn(async (key: string, fallback?: unknown) => (key in stored ? stored[key] : fallback)) } as never);

describe('buildPublicConfig — chat', () => {
  it('mặc định: tắt, giờ mặc định', async () => {
    const cfg = await build({});
    expect(cfg.chat).toEqual({ enabled: false, hours: DEFAULT_CHAT_HOURS });
  });

  it('chỉ boolean true thật mới bật', async () => {
    expect((await build({ 'chat.enabled': true })).chat.enabled).toBe(true);
    expect((await build({ 'chat.enabled': 'true' })).chat.enabled).toBe(false);
    expect((await build({ 'chat.enabled': 1 })).chat.enabled).toBe(false);
  });

  it('giờ hợp lệ được giữ, giờ hỏng rơi về mặc định', async () => {
    expect((await build({ 'chat.hours': { start: '09:00', end: '18:30' } })).chat.hours).toEqual({ start: '09:00', end: '18:30' });
    expect((await build({ 'chat.hours': { start: '25:00', end: '18:30' } })).chat.hours).toEqual(DEFAULT_CHAT_HOURS);
    expect((await build({ 'chat.hours': 'sáng' })).chat.hours).toEqual(DEFAULT_CHAT_HOURS);
  });

  it('giờ hợp lệ có khoá thừa thì chỉ trả start và end', async () => {
    const cfg = await build({ 'chat.hours': { start: '09:00', end: '18:00', note: 'internal' } });
    expect(cfg.chat.hours).toEqual({ start: '09:00', end: '18:00' });
  });

  it('không lộ mã nhóm Zalo và lời nhắn ngoài giờ', async () => {
    const cfg = await build({ 'chat.enabled': true, 'chat.zalo_group_id': 'g1', 'chat.off_hours_text': 'x' });
    expect(Object.keys(cfg.chat).sort()).toEqual(['enabled', 'hours']);
    expect(Object.keys(cfg.chat.hours).sort()).toEqual(['end', 'start']);
  });
});

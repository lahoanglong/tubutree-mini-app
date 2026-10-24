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

describe('buildPublicConfig — đơn vị vận hành', () => {
  it('mặc định: mọi trường null', async () => {
    expect((await build({})).company).toEqual({ legalName: null, taxCode: null, address: null, bctNoticeUrl: null });
  });

  it('trả tên, MST, địa chỉ đã cắt khoảng trắng; trường rỗng hoặc sai kiểu là null', async () => {
    const cfg = await build({ 'company.legal_name': ' Công ty A ', 'company.tax_code': '0312345678', 'company.address': '   ', 'company.bct_notice_url': 5 });
    expect(cfg.company).toEqual({ legalName: 'Công ty A', taxCode: '0312345678', address: null, bctNoticeUrl: null });
  });

  it('link Bộ Công Thương chỉ nhận https (không đưa javascript: hoặc http cho khách)', async () => {
    expect((await build({ 'company.bct_notice_url': 'https://online.gov.vn/x' })).company.bctNoticeUrl).toBe('https://online.gov.vn/x');
    expect((await build({ 'company.bct_notice_url': 'javascript:alert(1)' })).company.bctNoticeUrl).toBeNull();
    expect((await build({ 'company.bct_notice_url': 'http://online.gov.vn/x' })).company.bctNoticeUrl).toBeNull();
  });
});

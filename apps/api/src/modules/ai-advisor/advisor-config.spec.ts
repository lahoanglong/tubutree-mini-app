import { isAdvisorAvailable, isAdvisorEnabled, positiveInt, resolveProviderOrder } from './advisor-config';

const env = (o: Record<string, string>) => (k: string) => o[k];
const GW = { ANTIGRAVITY_GATEWAY_URL: 'http://gw', ANTIGRAVITY_GATEWAY_KEY: 'k' };

describe('advisor-config', () => {
  it('tự chọn: antigravity > deepseek > gemini theo cái đã cấu hình', () => {
    expect(resolveProviderOrder(env({ ...GW, DEEPSEEK_API_KEY: 'd', GEMINI_API_KEY: 'g' }))).toEqual(['antigravity', 'deepseek', 'gemini']);
    expect(resolveProviderOrder(env({ GEMINI_API_KEY: 'g' }))).toEqual(['gemini']);
    expect(resolveProviderOrder(env({}))).toEqual([]);
  });
  it('URL không có KEY (hoặc ngược lại) → antigravity không được dùng', () => {
    expect(resolveProviderOrder(env({ ANTIGRAVITY_GATEWAY_URL: 'http://gw' }))).toEqual([]);
    expect(resolveProviderOrder(env({ ANTIGRAVITY_GATEWAY_KEY: 'k' }))).toEqual([]);
  });
  it('selector rõ ràng → chỉ provider đó', () => {
    expect(resolveProviderOrder(env({ ...GW, DEEPSEEK_API_KEY: 'd', AI_ADVISOR_PROVIDER: 'deepseek' }))).toEqual(['deepseek']);
    expect(resolveProviderOrder(env({ DEEPSEEK_API_KEY: 'd', AI_ADVISOR_PROVIDER: 'antigravity' }))).toEqual([]);
  });
  it.each([['0'], ['false'], ['OFF'], ['no']])('AI_ADVISOR_ENABLED=%s → tắt', (v) => {
    expect(isAdvisorEnabled(env({ AI_ADVISOR_ENABLED: v }))).toBe(false);
    expect(isAdvisorAvailable(env({ ...GW, AI_ADVISOR_ENABLED: v }))).toBe(false);
  });
  it('để trống hoặc true → bật', () => {
    expect(isAdvisorEnabled(env({}))).toBe(true);
    expect(isAdvisorAvailable(env({ ...GW, AI_ADVISOR_ENABLED: 'true' }))).toBe(true);
  });
  it('positiveInt: rỗng, âm, chữ → mặc định', () => {
    expect(positiveInt('', 7)).toBe(7);
    expect(positiveInt('-3', 7)).toBe(7);
    expect(positiveInt('abc', 7)).toBe(7);
    expect(positiveInt(' 12 ', 7)).toBe(12);
  });
});

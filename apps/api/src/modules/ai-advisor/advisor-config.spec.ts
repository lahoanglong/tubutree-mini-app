import { isAdvisorAvailable, isAdvisorEnabled, positiveInt, providerConfigured, resolveProviderOrder } from './advisor-config';

const env = (o: Record<string, string>) => (k: string) => o[k];
const GW = { ANTIGRAVITY_GATEWAY_URL: 'http://gw', ANTIGRAVITY_GATEWAY_KEY: 'k' };

describe('advisor-config', () => {
  it('tự chọn: antigravity > claude > gemini > deepseek theo cái đã cấu hình', () => {
    expect(resolveProviderOrder(env({ ...GW, ANTHROPIC_API_KEY: 'a', DEEPSEEK_API_KEY: 'd', GEMINI_API_KEY: 'g' }))).toEqual(['antigravity', 'claude', 'gemini', 'deepseek']);
    expect(resolveProviderOrder(env({ ANTHROPIC_API_KEY: 'a', DEEPSEEK_API_KEY: 'd', GEMINI_API_KEY: 'g' }))).toEqual(['claude', 'gemini', 'deepseek']);
    expect(resolveProviderOrder(env({ DEEPSEEK_API_KEY: 'd', GEMINI_API_KEY: 'g' }))).toEqual(['gemini', 'deepseek']);
    expect(resolveProviderOrder(env({ GEMINI_API_KEY: 'g' }))).toEqual(['gemini']);
    expect(resolveProviderOrder(env({}))).toEqual([]);
  });
  it('claude chỉ tính là đã cấu hình khi ANTHROPIC_API_KEY có chữ (khoảng trắng không tính)', () => {
    expect(providerConfigured(env({ ANTHROPIC_API_KEY: 'a' }), 'claude')).toBe(true);
    expect(providerConfigured(env({ ANTHROPIC_API_KEY: '   ' }), 'claude')).toBe(false);
    expect(providerConfigured(env({ CLAUDE_API_MODEL: 'x' }), 'claude')).toBe(false);
  });
  it('chỉ có khoá Anthropic cũng đủ để AI tư vấn khả dụng', () => {
    expect(isAdvisorAvailable(env({ ANTHROPIC_API_KEY: 'a' }))).toBe(true);
    expect(isAdvisorAvailable(env({ ANTHROPIC_API_KEY: 'a', AI_ADVISOR_ENABLED: 'false' }))).toBe(false);
  });
  it('URL không có KEY (hoặc ngược lại) → antigravity không được dùng', () => {
    expect(resolveProviderOrder(env({ ANTIGRAVITY_GATEWAY_URL: 'http://gw' }))).toEqual([]);
    expect(resolveProviderOrder(env({ ANTIGRAVITY_GATEWAY_KEY: 'k' }))).toEqual([]);
  });
  it('selector rõ ràng → chỉ provider đó', () => {
    expect(resolveProviderOrder(env({ ...GW, DEEPSEEK_API_KEY: 'd', AI_ADVISOR_PROVIDER: 'deepseek' }))).toEqual(['deepseek']);
    expect(resolveProviderOrder(env({ DEEPSEEK_API_KEY: 'd', AI_ADVISOR_PROVIDER: 'antigravity' }))).toEqual([]);
  });
  it('selector claude → chỉ claude, không rơi sang provider khác; thiếu khoá thì rỗng', () => {
    expect(resolveProviderOrder(env({ ...GW, GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_ADVISOR_PROVIDER: 'claude' }))).toEqual(['claude']);
    expect(resolveProviderOrder(env({ ...GW, GEMINI_API_KEY: 'g', AI_ADVISOR_PROVIDER: 'claude' }))).toEqual([]);
    expect(resolveProviderOrder(env({ ANTHROPIC_API_KEY: 'a', AI_ADVISOR_PROVIDER: ' Claude ' }))).toEqual(['claude']);
  });
  it('selector provider khác thì khoá Anthropic không chen vào', () => {
    expect(resolveProviderOrder(env({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_ADVISOR_PROVIDER: 'gemini' }))).toEqual(['gemini']);
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

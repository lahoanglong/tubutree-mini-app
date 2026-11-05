import { ServiceUnavailableException } from '@nestjs/common';
import type { AdvisorProvider } from './advisor-config';
import type { AnthropicClient } from './anthropic.client';
import { LlmUnavailableException, type LlmClient } from './llm.client';
import type { StoryDraftInput } from './story-draft';
import { STORY_AI_BUDGET_MS, STORY_AI_MSG, StoryAiService } from './story-ai.service';

const input: StoryDraftInput = {
  name: 'Dầu rửa mặt PƠ LANG',
  brand: 'Pơ Lang',
  categories: ['Chăm sóc cá nhân'],
  price: 235_000,
  variations: [{ name: '100ml', price: 235_000 }],
  shortDesc: null,
  description: null,
  ingredients: [],
  certifications: [],
  note: '',
};

const GOOD = JSON.stringify({ steps: [{ title: 'Quả bơ', body: 'Dầu từ quả bơ.', sprite: 'oil-drop' }], callouts: [{ label: 'Dịu nhẹ' }], closing: 'Sạch mà êm' });

function make(opts: { configured: AdvisorProvider[]; claude?: boolean; via?: (p: readonly AdvisorProvider[]) => Promise<string>; claudeComplete?: () => Promise<string> }) {
  const calls: string[] = [];
  const llm = {
    hasProvider: (p: AdvisorProvider) => opts.configured.includes(p),
    completeVia: jest.fn(async (providers: readonly AdvisorProvider[]) => {
      calls.push(providers[0]!);
      return (opts.via ?? (async () => GOOD))(providers);
    }),
  } as unknown as LlmClient;
  const anthropic = {
    isConfigured: () => opts.claude ?? false,
    complete: jest.fn(async () => {
      calls.push('anthropic');
      return (opts.claudeComplete ?? (async () => GOOD))();
    }),
  } as unknown as AnthropicClient;
  return { svc: new StoryAiService(llm, anthropic), calls, llm, anthropic };
}

describe('StoryAiService.draft', () => {
  it('antigravity còn dùng được thì chỉ gọi antigravity, không tốn khoá Claude', async () => {
    const { svc, calls } = make({ configured: ['antigravity', 'deepseek'], claude: true });
    const out = await svc.draft(input);
    expect(out.provider).toBe('antigravity');
    expect(calls).toEqual(['antigravity']);
    expect(out.config.scenes.map((s) => s.kind)).toEqual(['ingredient_assembly', 'hud_callouts']);
  });

  it('antigravity lỗi thì sang Claude, rồi mới tới deepseek và gemini, đúng thứ tự', async () => {
    const boom = async (p: readonly AdvisorProvider[]) => {
      if (p[0] === 'gemini') return GOOD;
      throw new LlmUnavailableException('timeout');
    };
    const { svc, calls } = make({ configured: ['antigravity', 'deepseek', 'gemini'], claude: true, via: boom, claudeComplete: async () => { throw new Error('Claude 529 overloaded_error'); } });
    const out = await svc.draft(input);
    expect(calls).toEqual(['antigravity', 'anthropic', 'deepseek', 'gemini']);
    expect(out.provider).toBe('gemini');
  });

  it('không cấu hình antigravity thì bắt đầu từ Claude', async () => {
    const { svc, calls } = make({ configured: ['deepseek'], claude: true });
    expect((await svc.draft(input)).provider).toBe('anthropic');
    expect(calls).toEqual(['anthropic']);
  });

  it('provider trả JSON không dựng được kịch bản thì coi như lỗi và thử provider kế', async () => {
    const { svc, calls } = make({ configured: ['antigravity'], claude: true, via: async () => 'xin lỗi tôi không làm được' });
    const out = await svc.draft(input);
    expect(calls).toEqual(['antigravity', 'anthropic']);
    expect(out.provider).toBe('anthropic');
  });

  it('không có provider nào cấu hình thì 503 kèm câu hướng dẫn, không gọi ai', async () => {
    const { svc, llm, anthropic } = make({ configured: [], claude: false });
    await expect(svc.draft(input)).rejects.toThrow(new ServiceUnavailableException(STORY_AI_MSG.notConfigured));
    expect(llm.completeVia).not.toHaveBeenCalled();
    expect(anthropic.complete).not.toHaveBeenCalled();
  });

  it('mọi provider đều hỏng thì 503, câu lỗi không lộ nội dung provider trả', async () => {
    const { svc } = make({ configured: ['antigravity'], claude: true, via: async () => { throw new Error('secret-detail-from-gateway'); }, claudeComplete: async () => { throw new Error('Claude 401 authentication_error'); } });
    const err = await svc.draft(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((err as ServiceUnavailableException).getResponse())).toContain(STORY_AI_MSG.failed);
    expect(JSON.stringify((err as ServiceUnavailableException).getResponse())).not.toMatch(/secret-detail|authentication_error/);
  });

  it('gateway nhận prompt nguyên văn và trần token cho JSON kịch bản', async () => {
    const { svc, llm } = make({ configured: ['antigravity'] });
    await svc.draft(input);
    const call = (llm.completeVia as jest.Mock).mock.calls[0]!;
    expect(call[2]).toEqual({ maxTokens: 2000, rawGatewayPrompt: true });
    expect(call[1][1].content).toContain('Dầu rửa mặt PƠ LANG');
  });

  it('quá ngân sách thời gian thì không mở thêm provider kế tiếp', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, calls } = make({
      configured: ['antigravity', 'deepseek'],
      claude: true,
      via: async () => {
        now += STORY_AI_BUDGET_MS;
        throw new LlmUnavailableException('timeout');
      },
    });
    await expect(svc.draft(input)).rejects.toThrow(new ServiceUnavailableException(STORY_AI_MSG.failed));
    expect(calls).toEqual(['antigravity']);
    jest.restoreAllMocks();
  });
});

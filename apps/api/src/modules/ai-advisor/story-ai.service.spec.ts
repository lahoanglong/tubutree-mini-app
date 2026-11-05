import { ServiceUnavailableException } from '@nestjs/common';
import type { AdvisorProvider } from './advisor-config';
import type { AnthropicClient } from './anthropic.client';
import { LlmUnavailableException, type LlmClient } from './llm.client';
import type { StoryDraftInput } from './story-draft';
import { STORY_AI_BUDGET_MS, STORY_AI_GATEWAY_CAP_MS, STORY_AI_MAX_CONCURRENT, STORY_AI_MIN_SLICE_MS, STORY_AI_MSG, StoryAiService } from './story-ai.service';

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

  it('gateway nhận prompt nguyên văn, trần token cho JSON kịch bản và hạn chờ không vượt mức dành cho gateway', async () => {
    const { svc, llm } = make({ configured: ['antigravity'] });
    await svc.draft(input);
    const call = (llm.completeVia as jest.Mock).mock.calls[0]!;
    expect(call[2]).toEqual({ maxTokens: 8000, rawGatewayPrompt: true, timeoutMs: STORY_AI_GATEWAY_CAP_MS });
    expect(call[1][1].content).toContain('Dầu rửa mặt PƠ LANG');
  });

  it('Claude nhận trần token cao đủ cho phần suy nghĩ và toàn bộ ngân sách còn lại làm hạn chờ', async () => {
    const { svc, anthropic } = make({ configured: [], claude: true });
    await svc.draft(input);
    const [, , maxTokens, timeoutMs] = (anthropic.complete as jest.Mock).mock.calls[0]!;
    expect(maxTokens).toBe(8000);
    expect(timeoutMs).toBeLessThanOrEqual(STORY_AI_BUDGET_MS);
    expect(timeoutMs).toBeGreaterThan(STORY_AI_BUDGET_MS - 1_000);
  });

  it('ngân sách tổng phải ngắn hơn hạn đọc 60 giây của Apache', () => {
    expect(STORY_AI_BUDGET_MS).toBeLessThan(60_000);
  });

  it('antigravity chậm tới hạn riêng thì Claude vẫn còn phần ngân sách còn lại, nhưng ít hơn toàn bộ', async () => {
    let now = 5_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, anthropic } = make({
      configured: ['antigravity'],
      claude: true,
      via: async () => {
        now += STORY_AI_GATEWAY_CAP_MS;
        throw new LlmUnavailableException('timeout');
      },
    });
    await svc.draft(input);
    expect((anthropic.complete as jest.Mock).mock.calls[0]![3]).toBe(STORY_AI_BUDGET_MS - STORY_AI_GATEWAY_CAP_MS);
    jest.restoreAllMocks();
  });

  it('còn dưới mức tối thiểu thì không mở thêm provider kế tiếp', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, calls } = make({
      configured: ['antigravity', 'deepseek'],
      claude: true,
      via: async () => {
        now += STORY_AI_BUDGET_MS - STORY_AI_MIN_SLICE_MS + 1;
        throw new LlmUnavailableException('timeout');
      },
    });
    await expect(svc.draft(input)).rejects.toThrow(new ServiceUnavailableException(STORY_AI_MSG.failed));
    expect(calls).toEqual(['antigravity']);
    jest.restoreAllMocks();
  });

  it('cổng đồng thời riêng: quá STORY_AI_MAX_CONCURRENT lượt đang chạy thì từ chối lượt mới bằng câu bận, không gọi AI', async () => {
    const releases: (() => void)[] = [];
    let open = false;
    const { svc, llm } = make({
      configured: ['antigravity'],
      via: () => (open ? Promise.resolve(GOOD) : new Promise<string>((res) => releases.push(() => res(GOOD)))),
    });
    const running = Array.from({ length: STORY_AI_MAX_CONCURRENT }, () => svc.draft(input));
    await Promise.resolve();
    await expect(svc.draft(input)).rejects.toThrow(new ServiceUnavailableException(STORY_AI_MSG.busy));
    expect(llm.completeVia).toHaveBeenCalledTimes(STORY_AI_MAX_CONCURRENT);
    open = true;
    releases.forEach((r) => r());
    await Promise.all(running);
    await expect(svc.draft(input)).resolves.toBeDefined();
  });

  it('lượt lỗi vẫn trả chỗ trong cổng đồng thời', async () => {
    const { svc } = make({ configured: ['antigravity'], via: async () => { throw new Error('boom'); } });
    for (let i = 0; i < STORY_AI_MAX_CONCURRENT + 2; i++) {
      await expect(svc.draft(input)).rejects.toThrow(new ServiceUnavailableException(STORY_AI_MSG.failed));
    }
  });
});

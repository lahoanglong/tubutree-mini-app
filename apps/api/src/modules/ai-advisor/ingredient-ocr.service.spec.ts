import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AnthropicCallError, type AnthropicClient } from './anthropic.client';
import { IngredientOcrService, OCR_MAX_CONCURRENT, OCR_MSG, OCR_TIMEOUT_MS } from './ingredient-ocr.service';
import { OCR_MAX_TOKENS } from './ingredient-ocr';

const IMAGE = { mediaType: 'image/jpeg' as const, base64: 'QUJDRA==' };

function make(opts: { configured?: boolean; reply?: string | (() => Promise<string>) } = {}) {
  const completeWithImage = jest.fn(async (): Promise<string> => {
    const r = opts.reply ?? '{"readable":true,"ingredients":["Đường","Muối"]}';
    return typeof r === 'function' ? r() : r;
  });
  const client = { isConfigured: () => opts.configured ?? true, completeWithImage } as unknown as AnthropicClient;
  return { svc: new IngredientOcrService(client), completeWithImage };
}

const messageOf = (e: unknown) => (e as ServiceUnavailableException).getResponse() as { message: string };

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

describe('IngredientOcrService.read', () => {
  it('chưa có khoá AI: 503 tiếng Việt nói rõ vẫn nhập tay được, không gọi mạng', async () => {
    const { svc, completeWithImage } = make({ configured: false });
    expect(svc.isConfigured()).toBe(false);
    const err = await svc.read(IMAGE, 'Sữa hạt').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(messageOf(err).message).toBe(OCR_MSG.notConfigured);
    expect(OCR_MSG.notConfigured).toMatch(/nhập tay/);
    expect(completeWithImage).not.toHaveBeenCalled();
  });

  it('đọc được: trả danh sách tên, gọi model với ảnh, prompt có tên sản phẩm, trần token và hạn chờ đã định', async () => {
    const { svc, completeWithImage } = make();
    await expect(svc.read(IMAGE, 'Sữa hạt óc chó')).resolves.toEqual({ readable: true, ingredients: ['Đường', 'Muối'] });
    const [system, user, image, maxTokens, timeoutMs] = completeWithImage.mock.calls[0] as unknown as [string, string, unknown, number, number];
    expect(system).toMatch(/Thành phần/);
    expect(user).toContain('Sữa hạt óc chó');
    expect(image).toBe(IMAGE);
    expect(maxTokens).toBe(OCR_MAX_TOKENS);
    expect(timeoutMs).toBe(OCR_TIMEOUT_MS);
  });

  it('model báo ảnh không đọc được hoặc trả chữ không dựng được JSON: readable=false, không ném lỗi', async () => {
    await expect(make({ reply: '{"readable":false,"ingredients":[]}' }).svc.read(IMAGE, 'x')).resolves.toEqual({ readable: false, ingredients: [] });
    const garbage = make({ reply: 'Xin lỗi, tôi không đọc được.' });
    await expect(garbage.svc.read(IMAGE, 'x')).resolves.toEqual({ readable: false, ingredients: [] });
    expect(warn).toHaveBeenCalled();
  });

  it('Anthropic bận / quá giờ / lỗi khác: 503 với câu riêng cho từng loại, không lộ mã lỗi hay nội dung của Anthropic', async () => {
    const cases: [AnthropicCallError | Error, string][] = [
      [new AnthropicCallError('Claude 529 overloaded_error', 'busy'), OCR_MSG.busy],
      [new AnthropicCallError('Claude quá thời gian chờ.', 'timeout'), OCR_MSG.timeout],
      [new AnthropicCallError('Claude 401 authentication_error', 'error'), OCR_MSG.error],
      [new Error('Claude dừng sớm: max_tokens'), OCR_MSG.error],
    ];
    for (const [thrown, expected] of cases) {
      const { svc } = make({ reply: async () => Promise.reject(thrown) });
      const err = await svc.read(IMAGE, 'x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(messageOf(err).message).toBe(expected);
      expect(messageOf(err).message).not.toMatch(/Claude|529|401|max_tokens/);
    }
  });

  it(`tối đa ${OCR_MAX_CONCURRENT} lượt đọc cùng lúc: lượt thừa bị 503 bận ngay, không gọi model; xong thì nhả chỗ (kể cả khi lỗi)`, async () => {
    const releases: (() => void)[] = [];
    const { svc, completeWithImage } = make({ reply: () => new Promise<string>((res) => releases.push(() => res('{"readable":true,"ingredients":["A"]}'))) });
    const running = Array.from({ length: OCR_MAX_CONCURRENT }, () => svc.read(IMAGE, 'x'));
    const extra = await svc.read(IMAGE, 'x').catch((e: unknown) => e);
    expect(extra).toBeInstanceOf(ServiceUnavailableException);
    expect(messageOf(extra).message).toBe(OCR_MSG.busy);
    expect(completeWithImage).toHaveBeenCalledTimes(OCR_MAX_CONCURRENT);

    releases.forEach((r) => r());
    await Promise.all(running);
    const again = svc.read(IMAGE, 'x');
    expect(completeWithImage).toHaveBeenCalledTimes(OCR_MAX_CONCURRENT + 1);
    releases[releases.length - 1]!();
    await expect(again).resolves.toEqual({ readable: true, ingredients: ['A'] });

    const failing = make({ reply: async () => Promise.reject(new Error('boom')) });
    for (let i = 0; i < OCR_MAX_CONCURRENT + 2; i++) {
      const e = await failing.svc.read(IMAGE, 'x').catch((x: unknown) => x);
      expect(messageOf(e).message).toBe(OCR_MSG.error);
    }
  });
});

import { UnrecoverableError, type Job } from 'bullmq';
import { GomdonPushProcessor } from './gomdon-push.processor';
import type { GomdonOrderService } from './gomdon-order.service';
import type { GomdonWastePickupService } from './gomdon-waste-pickup.service';
import { GomdonRejectedError } from './gomdon.errors';

function job(name: string, attemptsMade: number, attempts = 5) {
  return { name, data: { orderId: 'o1' }, opts: { attempts }, attemptsMade } as unknown as Job<{ orderId: string }>;
}

describe('GomdonPushProcessor', () => {
  let gomdonOrder: {
    pushOrder: jest.Mock;
    markFinalPushFailure: jest.Mock;
    cancelOnGomdon: jest.Mock;
  };
  let gomdonWaste: { pushRequest: jest.Mock; markFinalPushFailure: jest.Mock; cancelOnGomdon: jest.Mock };
  let processor: GomdonPushProcessor;

  beforeEach(() => {
    gomdonWaste = {
      pushRequest: jest.fn().mockResolvedValue('BE9'),
      markFinalPushFailure: jest.fn().mockResolvedValue(undefined),
      cancelOnGomdon: jest.fn().mockResolvedValue(undefined),
    };
    gomdonOrder = {
      pushOrder: jest.fn().mockResolvedValue('BE1'),
      markFinalPushFailure: jest.fn().mockResolvedValue(undefined),
      cancelOnGomdon: jest.fn().mockResolvedValue(undefined),
    };
    processor = new GomdonPushProcessor(gomdonOrder as unknown as GomdonOrderService, gomdonWaste as unknown as GomdonWastePickupService);
  });

  it('job push thành công → không fail-safe', async () => {
    await processor.process(job('push', 0));
    expect(gomdonOrder.pushOrder).toHaveBeenCalledWith('o1');
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
  });

  it('lỗi ở lần chưa phải cuối → ném để BullMQ retry, chưa fail-safe', async () => {
    gomdonOrder.pushOrder.mockRejectedValueOnce(new Error('Gomdon 400'));
    await expect(processor.process(job('push', 1))).rejects.toThrow('Gomdon 400');
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
  });

  it('lỗi ở lần cuối → fail-safe markFinalPushFailure (FAILED + Pancake + báo CSKH)', async () => {
    const err = new Error('Gomdon 400');
    gomdonOrder.pushOrder.mockRejectedValueOnce(err);
    await expect(processor.process(job('push', 4))).resolves.toBeUndefined();
    expect(gomdonOrder.markFinalPushFailure).toHaveBeenCalledWith('o1', err);
  });

  it('fail-safe chính nó lỗi (DB down) → NÉM để job kết thúc failed (không kẹt ở completed)', async () => {
    gomdonOrder.pushOrder.mockRejectedValueOnce(new Error('db down'));
    gomdonOrder.markFinalPushFailure.mockRejectedValueOnce(new Error('db down'));
    await expect(processor.process(job('push', 4))).rejects.toThrow('db down');
  });

  it('UnrecoverableError (đã tạo vận đơn mà không ghi được DB) → ném thẳng, KHÔNG fail-safe "tạo tay"', async () => {
    gomdonOrder.pushOrder.mockRejectedValueOnce(new UnrecoverableError('không ghi được mã'));
    await expect(processor.process(job('push', 4))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
  });

  it('job cancel → cancelOnGomdon với cờ lần cuối', async () => {
    await processor.process(job('cancel', 0));
    expect(gomdonOrder.cancelOnGomdon).toHaveBeenCalledWith('o1', false);
    await processor.process(job('cancel', 4));
    expect(gomdonOrder.cancelOnGomdon).toHaveBeenLastCalledWith('o1', true);
    expect(gomdonOrder.pushOrder).not.toHaveBeenCalled();
  });
  it('UAT GOMDON-1: Gomdon từ chối DỨT KHOÁT (lỗi dữ liệu) → không chờ hết 8 lần, chốt sau vài lần', async () => {
    const err = new GomdonRejectedError('The source province field is required.');
    gomdonOrder.pushOrder.mockRejectedValue(err);
    await expect(processor.process(job('push', 1, 8))).rejects.toBe(err);
    await expect(processor.process(job('push', 2, 8))).resolves.toBeUndefined();
    expect(gomdonOrder.markFinalPushFailure).toHaveBeenCalledWith('o1', err);
  });

  it('UAT GOMDON-1: lỗi TẠM (503/mạng/đăng nhập) → thử đủ số lần của job rồi mới fail-safe', async () => {
    const err = new GomdonRejectedError('HTTP 503', { transient: true });
    gomdonOrder.pushOrder.mockRejectedValue(err);
    await expect(processor.process(job('push', 2, 8))).rejects.toBe(err);
    await expect(processor.process(job('push', 6, 8))).rejects.toBe(err);
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
    await processor.process(job('push', 7, 8));
    expect(gomdonOrder.markFinalPushFailure).toHaveBeenCalledWith('o1', err);
  });
  describe('job phiếu thu gom tận nhà (waste-push / waste-cancel)', () => {
    const wjob = (name: string, attemptsMade: number, attempts = 8) =>
      ({ name, data: { requestId: 'r1' }, opts: { attempts }, attemptsMade }) as unknown as Job<{ requestId: string }>;

    it('waste-push đi vào GomdonWastePickupService, không đụng đơn mua hàng', async () => {
      await processor.process(wjob('waste-push', 0) as never);
      expect(gomdonWaste.pushRequest).toHaveBeenCalledWith('r1');
      expect(gomdonOrder.pushOrder).not.toHaveBeenCalled();
      expect(gomdonWaste.markFinalPushFailure).not.toHaveBeenCalled();
    });

    it('lỗi chưa phải lần cuối: ném để BullMQ thử lại, chưa huỷ phiếu', async () => {
      gomdonWaste.pushRequest.mockRejectedValueOnce(new GomdonRejectedError('HTTP 503', { transient: true }));
      await expect(processor.process(wjob('waste-push', 2) as never)).rejects.toThrow('HTTP 503');
      expect(gomdonWaste.markFinalPushFailure).not.toHaveBeenCalled();
    });

    it('lỗi tạm hết lượt thử: huỷ phiếu và hoàn điểm (markFinalPushFailure)', async () => {
      const err = new GomdonRejectedError('HTTP 503', { transient: true });
      gomdonWaste.pushRequest.mockRejectedValue(err);
      await expect(processor.process(wjob('waste-push', 7) as never)).resolves.toBeUndefined();
      expect(gomdonWaste.markFinalPushFailure).toHaveBeenCalledWith('r1', err);
    });

    it('Gomdon từ chối dứt khoát: chốt sau 3 lần, không chờ hết 8 lần', async () => {
      const err = new GomdonRejectedError('The source province field is required.');
      gomdonWaste.pushRequest.mockRejectedValue(err);
      await expect(processor.process(wjob('waste-push', 1) as never)).rejects.toBe(err);
      await expect(processor.process(wjob('waste-push', 2) as never)).resolves.toBeUndefined();
      expect(gomdonWaste.markFinalPushFailure).toHaveBeenCalledWith('r1', err);
    });

    it('UnrecoverableError (đã tạo vận đơn mà không ghi được DB): ném thẳng, KHÔNG huỷ phiếu không hoàn điểm', async () => {
      gomdonWaste.pushRequest.mockRejectedValue(new UnrecoverableError('không ghi được mã'));
      await expect(processor.process(wjob('waste-push', 7) as never)).rejects.toBeInstanceOf(UnrecoverableError);
      expect(gomdonWaste.markFinalPushFailure).not.toHaveBeenCalled();
    });

    it('fail-safe chính nó lỗi: ném để job failed, cron cứu hộ xếp lại', async () => {
      gomdonWaste.pushRequest.mockRejectedValue(new GomdonRejectedError('x', { transient: true }));
      gomdonWaste.markFinalPushFailure.mockRejectedValue(new Error('db down'));
      await expect(processor.process(wjob('waste-push', 7) as never)).rejects.toThrow('db down');
    });

    it('waste-cancel truyền cờ lần cuối', async () => {
      await processor.process(wjob('waste-cancel', 0) as never);
      expect(gomdonWaste.cancelOnGomdon).toHaveBeenCalledWith('r1', false);
      await processor.process(wjob('waste-cancel', 7) as never);
      expect(gomdonWaste.cancelOnGomdon).toHaveBeenLastCalledWith('r1', true);
      expect(gomdonWaste.pushRequest).not.toHaveBeenCalled();
      expect(gomdonOrder.cancelOnGomdon).not.toHaveBeenCalled();
    });
  });
});

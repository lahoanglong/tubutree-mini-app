import type { Queue } from 'bullmq';
import {
  GOMDON_OUTBOUND_JOB_OPTIONS,
  addGomdonJob,
  enqueueGomdonCancel,
  enqueueGomdonPush,
  enqueueGomdonWasteCancel,
  enqueueGomdonWastePush,
  gomdonCancelJobId,
  gomdonWasteCancelJobId,
  gomdonWastePushJobId,
} from './gomdon-queue';

/**
 * Queue giả mô phỏng ĐÚNG hành vi dedupe của BullMQ addStandardJob: jobId còn tồn tại (kể cả job đã
 * completed — removeOnComplete giữ 1000 job) thì add() KHÔNG enqueue gì. Mock add() trơn (như spec
 * WIP cũ) che mất đúng lỗi "cron re-enqueue là no-op".
 */
function fakeBullQueue(initial: Record<string, string> = {}) {
  const jobs = new Map<string, { state: string }>(Object.entries(initial).map(([id, state]) => [id, { state }]));
  const enqueued: { name: string; data: unknown; jobId: string }[] = [];
  const queue = {
    getJob: jest.fn(async (id: string) => {
      const j = jobs.get(id);
      if (!j) return undefined;
      return {
        getState: async () => j.state,
        remove: async () => {
          jobs.delete(id);
        },
      };
    }),
    add: jest.fn(async (name: string, data: unknown, opts: { jobId: string }) => {
      if (jobs.has(opts.jobId)) return { id: opts.jobId }; // BullMQ: trùng jobId → bỏ qua
      jobs.set(opts.jobId, { state: 'waiting' });
      enqueued.push({ name, data, jobId: opts.jobId });
      return { id: opts.jobId };
    }),
  };
  return { queue: queue as unknown as Queue, enqueued, jobs };
}

describe('gomdon-queue', () => {
  it('job push cũ đã COMPLETED (fallback trước đó nuốt lỗi) → xoá rồi enqueue lại được', async () => {
    const { queue, enqueued } = fakeBullQueue({ o1: 'completed' });
    await enqueueGomdonPush(queue, 'o1');
    expect(enqueued).toEqual([{ name: 'push', data: { orderId: 'o1' }, jobId: 'o1' }]);
  });

  it('job FAILED → xoá rồi enqueue lại', async () => {
    const { queue, enqueued } = fakeBullQueue({ o1: 'failed' });
    await enqueueGomdonPush(queue, 'o1');
    expect(enqueued).toHaveLength(1);
  });

  it('job đang waiting/active/delayed → GIỮ nguyên, không enqueue trùng', async () => {
    for (const state of ['waiting', 'active', 'delayed']) {
      const { queue, enqueued } = fakeBullQueue({ o1: state });
      await enqueueGomdonPush(queue, 'o1');
      expect(enqueued).toHaveLength(0);
    }
  });

  it('đọc trạng thái job lỗi (Redis blip) → vẫn add (BullMQ tự dedupe)', async () => {
    const { queue } = fakeBullQueue();
    (queue.getJob as jest.Mock).mockRejectedValueOnce(new Error('redis'));
    await addGomdonJob(queue, 'push', { orderId: 'o1' }, 'o1');
    expect(queue.add).toHaveBeenCalledWith('push', { orderId: 'o1' }, { jobId: 'o1' });
  });

  it('job huỷ dùng jobId riêng, KHÔNG chứa ":" (BullMQ 5 từ chối)', async () => {
    const { queue, enqueued } = fakeBullQueue({ o1: 'completed' }); // job push cùng đơn không chặn job huỷ
    await enqueueGomdonCancel(queue, 'o1');
    expect(enqueued).toEqual([{ name: 'cancel', data: { orderId: 'o1' }, jobId: 'cancel-o1' }]);
    expect(gomdonCancelJobId('o1')).not.toContain(':');
  });
  it('UAT GOMDON-1: job tạo/huỷ vận đơn có cửa sổ thử lại riêng dài hơn ~30 giây mặc định của BullMQ', async () => {
    const { queue } = fakeBullQueue();
    await enqueueGomdonPush(queue, 'o1');
    await enqueueGomdonCancel(queue, 'o1');
    const opts = (queue.add as jest.Mock).mock.calls.map((c) => c[2]);
    for (const o of opts) expect(o).toMatchObject(GOMDON_OUTBOUND_JOB_OPTIONS);
    const { attempts, backoff } = GOMDON_OUTBOUND_JOB_OPTIONS;
    // exponential: delay * 2^(n-1) giữa các lần — tổng phải đủ phủ một sự cố Gomdon vài phút.
    const totalMs = Array.from({ length: attempts - 1 }, (_, i) => backoff.delay * 2 ** i).reduce((a, b) => a + b, 0);
    expect(totalMs).toBeGreaterThanOrEqual(5 * 60_000);
  });
  it('phiếu thu gom tận nhà: jobId cố định theo MÃ PHIẾU (một phiếu không bao giờ có hai job tạo vận đơn), push và cancel khác nhau, không chứa ":"', async () => {
    expect(gomdonWastePushJobId('TR-AAAAA')).toBe('wr-push-TR-AAAAA');
    expect(gomdonWasteCancelJobId('TR-AAAAA')).toBe('wr-cancel-TR-AAAAA');
    for (const id of [gomdonWastePushJobId('TR-AAAAA'), gomdonWasteCancelJobId('TR-AAAAA')]) expect(id).not.toContain(':');
    const { queue, enqueued } = fakeBullQueue();
    await enqueueGomdonWastePush(queue, 'r1', 'TR-AAAAA');
    await enqueueGomdonWastePush(queue, 'r1', 'TR-AAAAA');
    expect(enqueued).toEqual([{ name: 'waste-push', data: { requestId: 'r1' }, jobId: 'wr-push-TR-AAAAA' }]);
  });

  it('job huỷ vận đơn của phiếu thu gom đi riêng, không bị job tạo vận đơn đã completed chặn, cùng cửa sổ thử lại dài', async () => {
    const { queue, enqueued } = fakeBullQueue({ 'wr-push-TR-AAAAA': 'completed' });
    await enqueueGomdonWasteCancel(queue, 'r1', 'TR-AAAAA');
    expect(enqueued).toEqual([{ name: 'waste-cancel', data: { requestId: 'r1' }, jobId: 'wr-cancel-TR-AAAAA' }]);
    expect((queue.add as jest.Mock).mock.calls[0]![2]).toMatchObject(GOMDON_OUTBOUND_JOB_OPTIONS);
  });

  it('job tạo vận đơn phiếu thu gom đã failed hoặc completed: xoá rồi xếp lại được (cron cứu hộ), job đang chạy thì giữ nguyên', async () => {
    for (const state of ['failed', 'completed']) {
      const { queue, enqueued } = fakeBullQueue({ 'wr-push-TR-AAAAA': state });
      await enqueueGomdonWastePush(queue, 'r1', 'TR-AAAAA');
      expect(enqueued).toHaveLength(1);
    }
    const { queue, enqueued } = fakeBullQueue({ 'wr-push-TR-AAAAA': 'active' });
    await enqueueGomdonWastePush(queue, 'r1', 'TR-AAAAA');
    expect(enqueued).toHaveLength(0);
  });
});

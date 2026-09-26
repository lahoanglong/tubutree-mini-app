import type { Queue } from 'bullmq';
import { addGomdonJob, enqueueGomdonCancel, enqueueGomdonPush, gomdonCancelJobId } from './gomdon-queue';

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
});

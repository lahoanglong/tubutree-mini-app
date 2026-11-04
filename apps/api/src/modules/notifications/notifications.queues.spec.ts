import 'reflect-metadata';
import { NotificationsProcessor, InAppRetryProcessor, ZNS_WORKER_OPTIONS, INAPP_RETRY_WORKER_OPTIONS } from './notifications.processor';
import { QUEUE_NOTIFICATIONS, QUEUE_NOTIFICATIONS_INAPP_RETRY } from '../../jobs/queues';

const meta = (target: object, key: string) => Reflect.getMetadata(key, target) as Record<string, unknown> | undefined;

describe('Hàng notifications: ZNS và thử lại tin trong app tách riêng (L3-06)', () => {
  it('hai hàng khác tên', () => {
    expect(QUEUE_NOTIFICATIONS).toBe('notifications');
    expect(QUEUE_NOTIFICATIONS_INAPP_RETRY).toBe('notifications-inapp-retry');
  });

  it('worker ZNS: concurrency 5, limiter 10 job mỗi giây', () => {
    expect(ZNS_WORKER_OPTIONS).toEqual({ concurrency: 5, limiter: { max: 10, duration: 1000 } });
    expect(meta(NotificationsProcessor, 'bullmq:processor_metadata')).toMatchObject({ name: QUEUE_NOTIFICATIONS });
    expect(meta(NotificationsProcessor, 'bullmq:worker_metadata')).toEqual(ZNS_WORKER_OPTIONS);
  });

  it('worker thử lại tin trong app nghe hàng riêng, không limiter (không gọi Zalo)', () => {
    expect(meta(InAppRetryProcessor, 'bullmq:processor_metadata')).toMatchObject({ name: QUEUE_NOTIFICATIONS_INAPP_RETRY });
    expect(meta(InAppRetryProcessor, 'bullmq:worker_metadata')).toEqual(INAPP_RETRY_WORKER_OPTIONS);
    expect(INAPP_RETRY_WORKER_OPTIONS).not.toHaveProperty('limiter');
  });
});

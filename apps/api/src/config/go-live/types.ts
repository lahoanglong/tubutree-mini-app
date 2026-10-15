export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface CheckResult {
  id: string;
  group: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** Cách sửa; bắt buộc với WARN/FAIL, để trống với PASS. */
  hint: string;
}

/** `pre-deploy`: chạy trên server trước khi áp migration mới, nên migration chưa áp là việc sắp làm chứ không phải lỗi. */
export type GoLivePhase = 'pre-deploy' | 'post-deploy';

export type Env = Readonly<Record<string, string | undefined>>;

export function pass(group: string, id: string, title: string, detail: string): CheckResult {
  return { id, group, title, status: 'PASS', detail, hint: '' };
}

export function warn(group: string, id: string, title: string, detail: string, hint: string): CheckResult {
  return { id, group, title, status: 'WARN', detail, hint };
}

export function fail(group: string, id: string, title: string, detail: string, hint: string): CheckResult {
  return { id, group, title, status: 'FAIL', detail, hint };
}

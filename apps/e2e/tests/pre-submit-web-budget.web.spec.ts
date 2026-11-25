import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * Trước khi gửi duyệt Zalo (tubu-w36-02): ngân sách web đo trên bản build `next start` có dữ liệu seed của web-gate.sh (E2E_WEB_PROD=1):
 * `scripts/ci/web-budget.cjs --html-base` lấy HTML chưa nén của `/` (trần 215.000 B trong scripts/ci/web-budget.json) cùng JS gzip tải lần đầu
 * của các route. `next dev` dựng HTML khác hẳn bản build nên ca này chỉ chạy dưới web-gate.sh.
 */
const ROOT = path.resolve(__dirname, '../../..');
const HTML_MAX = 215_000;

test('ngân sách web trên bản build: HTML / ≤ 215.000 B chưa nén, JS gzip mọi route trong ngưỡng', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer', 'Đo một lần trên máy chủ web');
  test.skip(process.env.E2E_WEB_PROD !== '1', 'Chỉ đo trên bản build `next start` của web-gate.sh');
  const base = String(testInfo.project.use.baseURL);
  let report = '';
  let rc = 0;
  try {
    report = execFileSync(process.execPath, [path.join(ROOT, 'scripts/ci/web-budget.cjs'), path.join(ROOT, 'apps/web/.next'), '--html-base', base], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    report = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    rc = err.status ?? 1;
  }
  console.log(`[web-budget ${base}]\n${report}`);
  await testInfo.attach('web-budget', { body: report, contentType: 'text/plain' });
  const home = /^\| \/ \| (\d+) B \| (\d+) B \| ([^|]+) \|$/m.exec(report);
  expect(home, 'web-budget phải in dòng HTML của /').not.toBeNull();
  expect(Number(home![2])).toBe(HTML_MAX);
  expect(Number(home![1])).toBeLessThanOrEqual(HTML_MAX);
  expect(rc, report).toBe(0);
});

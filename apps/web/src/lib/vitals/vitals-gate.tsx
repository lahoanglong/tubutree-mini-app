import { getRumConfig } from './rum-config';
import { WebVitalsReporter } from './web-vitals-reporter';

/** Thành phần máy chủ: đọc cờ rồi chỉ đưa xuống trình duyệt hai giá trị `enabled`, `samplePct`. */
export async function VitalsGate() {
  const rum = await getRumConfig();
  return <WebVitalsReporter {...rum} />;
}

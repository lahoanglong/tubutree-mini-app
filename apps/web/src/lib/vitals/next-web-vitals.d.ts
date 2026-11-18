// Bản `web-vitals` Next gói sẵn (cùng bản `useReportWebVitals` dùng) không kèm tệp kiểu.
declare module 'next/dist/compiled/web-vitals' {
  type OnMetric = (cb: (m: { name: string; value: number; navigationType?: string }) => void, opts?: { reportAllChanges?: boolean }) => void;
  export const onLCP: OnMetric;
  export const onCLS: OnMetric;
  export const onINP: OnMetric;
  export const onFCP: OnMetric;
  export const onTTFB: OnMetric;
}

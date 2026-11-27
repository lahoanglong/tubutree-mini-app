'use client';

import { useMemo, useState } from 'react';
import {
  INSERT_QR_CHANNELS,
  INSERT_QR_CHANNEL_LABEL,
  INSERT_QR_TAG_MAX,
  downloadBlob,
  insertQrFileName,
  insertQrUrl,
  qrPngBlob,
  qrSvg,
  svgDataUrl,
  type InsertQrChannel,
} from '@/lib/insert-qr';
import { BTN_SECONDARY, Field, INPUT_CLASS, chipClass } from './ui';

/**
 * Mã QR in lên thẻ bỏ vào hộp hàng bán trên sàn (W43, chỉ ADMIN). Chọn sàn và tên đợt thẻ, xem trước link và mã, tải SVG để in hoặc PNG
 * 1024px. Không gửi gì lên máy chủ: link chỉ mang nguồn và đợt thẻ để biết thẻ nào mang khách về.
 */
export function ExternalInsertQrCard() {
  const [channel, setChannel] = useState<InsertQrChannel>('shopee');
  const [tag, setTag] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pngBusy, setPngBusy] = useState(false);
  const url = insertQrUrl(channel, tag);
  const svg = useMemo(() => (url ? qrSvg(url) : null), [url]);

  const downloadPng = async () => {
    if (!url || pngBusy) return;
    setFailure(null);
    setPngBusy(true);
    try {
      downloadBlob(await qrPngBlob(url, 1024), insertQrFileName(channel, tag, 'png'));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Không tạo được ảnh PNG.');
    } finally {
      setPngBusy(false);
    }
  };

  return (
    <section aria-labelledby="external-insert-qr-title" data-external-insert-qr className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h3 id="external-insert-qr-title" className="font-display text-sm font-semibold text-stone-900">
        Mã QR in thẻ bỏ hộp
      </h3>
      <p className="mt-0.5 text-xs text-stone-600">
        Khách quét bằng camera điện thoại sẽ mở màn tích điểm đơn sàn trong Mini App trên Zalo. Mã không kèm mã giảm giá.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-3">
          <div>
            <span id="insert-qr-channel" className="text-xs font-medium text-stone-700">
              Sàn bán hàng
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-labelledby="insert-qr-channel">
              {INSERT_QR_CHANNELS.map((c) => (
                <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)} className={chipClass(channel === c)}>
                  {INSERT_QR_CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Tên đợt thẻ (không bắt buộc)"
            hint={`Chữ thường không dấu, số, gạch ngang hoặc gạch dưới, tối đa ${INSERT_QR_TAG_MAX} ký tự, ví dụ box-2026-11. Dùng để biết đợt thẻ nào mang khách về.`}
          >
            <input
              className={`${INPUT_CLASS} min-h-[44px] sm:min-h-0`}
              value={tag}
              maxLength={INSERT_QR_TAG_MAX}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={url === null || undefined}
              onChange={(e) => setTag(e.target.value)}
            />
          </Field>
          {url === null ? (
            <p role="alert" className="text-xs text-danger-fg">
              Tên đợt thẻ chỉ gồm chữ thường không dấu, số, gạch ngang hoặc gạch dưới, bắt đầu bằng chữ hoặc số.
            </p>
          ) : (
            <p className="text-xs text-stone-700">
              Link trong mã: <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-stone-900">{url}</code>
            </p>
          )}
          {failure && (
            <p role="alert" className="text-xs text-danger-fg">
              {failure}
            </p>
          )}
        </div>
        {url && svg && (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh SVG tạo ngay trong trình duyệt (data URL), next/image không tối ưu được */}
            <img src={svgDataUrl(svg)} alt={`Mã QR dẫn tới ${url}`} width={160} height={160} className="h-40 w-40 border border-stone-200" />
            <div className="flex gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), insertQrFileName(channel, tag, 'svg'))}>
                Tải SVG
              </button>
              <button type="button" className={BTN_SECONDARY} aria-busy={pngBusy || undefined} disabled={pngBusy} onClick={() => void downloadPng()}>
                Tải PNG
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

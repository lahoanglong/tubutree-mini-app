'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { getConfig } from '@/lib/admin-client';
import { marketplaceEarnPct } from '@/lib/external-o2o-settings';
import { A6_CARD_MM, A6_CARD_PX, formatEarnPct, insertQrCardFileName, insertQrCardPngBlob, insertQrCardSvg, printInsertQrCard } from '@/lib/insert-qr-card';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, Field, INPUT_CLASS, chipClass } from './ui';

/**
 * Thẻ bỏ vào hộp hàng bán trên sàn (W43, chỉ ADMIN). Chọn sàn và tên đợt thẻ, xem trước thẻ A6 và link, tải PNG A6 300 DPI hoặc in/lưu PDF
 * (W49-02); vẫn tải riêng mã QR dạng SVG hoặc PNG 1024px. Không gửi gì lên máy chủ: link chỉ mang nguồn và đợt thẻ để biết thẻ nào mang khách về.
 */
export function ExternalInsertQrCard() {
  const [channel, setChannel] = useState<InsertQrChannel>('shopee');
  const [tag, setTag] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pngBusy, setPngBusy] = useState(false);
  const [a6Busy, setA6Busy] = useState<'png' | 'print' | null>(null);
  // Cùng khoá và bộ nhớ đệm với ExternalO2oSettingsCard ngay phía trên: lưu tỉ lệ mới ở đó thì thẻ ở đây đổi theo, không gọi API thêm.
  const configQ = useQuery({ queryKey: ['admin-config'], queryFn: () => getConfig() });
  const earnPct = marketplaceEarnPct(configQ.data);
  const url = insertQrUrl(channel, tag);
  const svg = useMemo(() => (url ? qrSvg(url) : null), [url]);
  const cardSvg = useMemo(() => (url ? insertQrCardSvg(url, channel, { earnPct }) : null), [url, channel, earnPct]);

  const downloadA6Png = async () => {
    if (!url || !cardSvg || a6Busy) return;
    setFailure(null);
    setA6Busy('png');
    try {
      downloadBlob(await insertQrCardPngBlob(cardSvg), insertQrCardFileName(channel, tag));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Không tạo được ảnh thẻ A6.');
    } finally {
      setA6Busy(null);
    }
  };

  const printA6 = async () => {
    if (!url || a6Busy) return;
    setFailure(null);
    setA6Busy('print');
    try {
      await printInsertQrCard(insertQrCardSvg(url, channel, { unit: 'mm', earnPct }));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Không mở được hộp thoại in.');
    } finally {
      setA6Busy(null);
    }
  };

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
        Thẻ A6 có sẵn nhãn sàn, mã QR và ba bước hướng dẫn, in được ngay. Khách quét bằng camera điện thoại vào trang tích điểm đơn sàn, rồi sang màn quét trong Mini App trên Zalo (tự mở khi bật &quot;Tự mở Mini App trên web điện thoại&quot;, không thì khách bấm nút). Mã không kèm mã giảm giá.
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
        {url && svg && cardSvg && (
          <div className="flex min-w-0 flex-col items-center gap-2 sm:w-64">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh SVG tạo ngay trong trình duyệt (data URL), next/image không tối ưu được */}
            <img
              src={svgDataUrl(cardSvg)}
              alt={`Thẻ A6 ${INSERT_QR_CHANNEL_LABEL[channel]}, mã QR dẫn tới ${url}`}
              width={A6_CARD_PX.widthPx}
              height={A6_CARD_PX.heightPx}
              data-a6-card-preview
              className="h-auto w-44 border border-stone-200"
            />
            <p className="text-xs text-stone-600">
              Thẻ A6 {A6_CARD_MM.widthMm} × {A6_CARD_MM.heightMm} mm. PNG đã gắn 300 DPI; khi in, chọn &quot;Lưu dưới dạng PDF&quot; để có tệp PDF.
            </p>
            <p data-card-earn-pct className="text-xs text-stone-600">
              {earnPct != null
                ? `Thẻ ghi "Nhận ${formatEarnPct(earnPct)}% Điểm Xanh" theo cài đặt hiện tại; đổi tỉ lệ thì tải lại thẻ.`
                : 'Chưa đọc được tỉ lệ tích điểm nên thẻ chỉ ghi "Nhận Điểm Xanh".'}
            </p>
            <button type="button" className={`${BTN_PRIMARY} w-full`} aria-busy={a6Busy === 'png' || undefined} disabled={a6Busy !== null} onClick={() => void downloadA6Png()}>
              Tải PNG thẻ A6 sẵn in (300 DPI)
            </button>
            <button type="button" className={`${BTN_SECONDARY} w-full`} aria-busy={a6Busy === 'print' || undefined} disabled={a6Busy !== null} onClick={() => void printA6()}>
              In / Lưu PDF thẻ A6 (10×15cm)
            </button>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-stone-600">Chỉ mã QR</span>
              <button type="button" className={BTN_XS_SECONDARY} onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), insertQrFileName(channel, tag, 'svg'))}>
                Tải SVG
              </button>
              <button type="button" className={BTN_XS_SECONDARY} aria-busy={pngBusy || undefined} disabled={pngBusy} onClick={() => void downloadPng()}>
                Tải PNG
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

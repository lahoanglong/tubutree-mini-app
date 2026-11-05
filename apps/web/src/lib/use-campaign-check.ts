'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkAdminCampaign,
  type CampaignCheckInput,
  type CampaignIssue,
} from './admin-campaigns-client';
import { ApiError } from './client-api';
import { actionErrorText } from './admin-error-text';

/** Đợi form ngừng đổi chừng này rồi mới hỏi máy chủ, để gõ liên tục không bắn từng phím. */
export const CHECK_DEBOUNCE_MS = 400;

export interface CampaignCheckState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  issues: CampaignIssue[];
  blockers: number;
  warnings: number;
  /** Phán quyết lần lưu của máy chủ cho đúng bản nháp đã kiểm (thiếu khi API cũ). */
  verdict?: { blocked: boolean; codes: string[]; reason?: string };
  /** Lý do chưa kiểm được (status `error`). */
  message?: string;
}

export type CampaignCheck = CampaignCheckState & {
  /** Hỏi máy chủ lại ngay với đúng bản nháp hiện tại (dữ liệu bên ngoài form như sản phẩm, mã có thể đã đổi). */
  recheck: () => void;
};

const IDLE: CampaignCheckState = { status: 'idle', issues: [], blockers: 0, warnings: 0 };

/**
 * Kiểm chiến dịch đang soạn bằng `POST /admin/campaigns/check`. `input` null (form chưa đủ để kiểm) thì không gọi gì. Máy chủ trả 400 vì đích sai
 * định dạng thì hiện đúng câu đó như một lỗi chặn; lỗi mạng hay 5xx không khoá nút lưu (máy chủ vẫn kiểm lại lúc bật).
 * Sản phẩm và mã ngoài form có thể đổi trong lúc form mở (người khác sửa, tab khác), nên kiểm lại khi cửa sổ được focus lại hoặc tab hiện lại
 * (không khi `paused`, ví dụ đang lưu) và khi gọi `recheck`. Kiểm lại cùng bản nháp giữ kết quả cũ cho tới khi có kết quả mới, không nhấp nháy khoá.
 */
export function useCampaignCheck(input: CampaignCheckInput | null, opts: { paused?: boolean } = {}): CampaignCheck {
  const [state, setState] = useState<CampaignCheckState & { forKey: string }>({ ...IDLE, forKey: '' });
  const [round, setRound] = useState(0);
  const key = input ? JSON.stringify(input) : '';
  const latest = useRef(input);
  latest.current = input;
  const paused = useRef(false);
  paused.current = opts.paused === true;
  const immediate = useRef(false);

  const recheck = useCallback(() => {
    immediate.current = true;
    setRound((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!key) return;
    const again = () => {
      if (paused.current || document.visibilityState === 'hidden') return;
      setRound((n) => n + 1);
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [key]);

  useEffect(() => {
    const body = latest.current;
    if (!body) {
      setState({ ...IDLE, forKey: '' });
      return;
    }
    let live = true;
    const delay = immediate.current ? 0 : CHECK_DEBOUNCE_MS;
    immediate.current = false;
    setState((s) => (s.forKey === key && s.status === 'ready' ? s : { ...s, status: 'loading', forKey: key }));
    const timer = setTimeout(() => {
      checkAdminCampaign(body).then(
        (r) =>
          live &&
          setState({
            forKey: key,
            status: 'ready',
            issues: r.issues,
            blockers: r.blockers,
            warnings: r.warnings,
            ...(r.verdict ? { verdict: r.verdict } : {}),
          }),
        (e: unknown) => {
          if (!live) return;
          if (e instanceof ApiError && e.status === 400) {
            setState({
              forKey: key,
              status: 'ready',
              issues: [{ code: 'INVALID', level: 'BLOCK', message: e.message }],
              blockers: 1,
              warnings: 0,
              verdict: { blocked: true, codes: ['INVALID'], reason: e.message },
            });
            return;
          }
          setState({
            forKey: key,
            status: 'error',
            issues: [],
            blockers: 0,
            warnings: 0,
            message: actionErrorText(e),
          });
        },
      );
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, round]);

  // Kết quả của bản nháp cũ (vừa gõ thêm, chưa kịp kiểm lại) vẫn hiện trong khối kiểm nhưng không được dùng để khoá hay mở khoá bản nháp mới.
  const { forKey, verdict, ...rest } = state;
  if (forKey !== key) return { ...(input ? { ...rest, status: 'loading' as const } : IDLE), recheck };
  return { ...rest, ...(verdict ? { verdict } : {}), recheck };
}

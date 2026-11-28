'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/lib/client-api';
import { useAuth } from '@/lib/auth-context';
import { retryAfterSec, webLoginErrorMessage } from '@/lib/login-errors';
import { ui } from '@/lib/guest-ui';
import { Field } from '@/components/ui/field';

const OTP_LENGTH = 6;
const DEFAULT_TTL_SEC = 600;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_FAILURES = new Set(['EMAIL_OTP_WRONG', 'EMAIL_OTP_LOCKED', 'EMAIL_OTP_EXPIRED']);
const OTP_FIELD = `${ui.field.replace('text-sm', 'text-lg')} text-center font-semibold tracking-[0.4em] tabular-nums`;
const OTP_FIELD_ERROR = `${ui.fieldError.replace('text-sm', 'text-lg')} text-center font-semibold tracking-[0.4em] tabular-nums`;

interface OtpRequestReply {
  email: string;
  resendAfterSec: number;
  expiresInSec: number;
}

/** Số giây còn lại tới mốc `until` (ms), cập nhật mỗi giây; 0 khi đã qua. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (until <= Date.now()) return;
    const t = window.setInterval(() => {
      tick();
      if (Date.now() >= until) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/**
 * Đăng nhập bằng mã 6 số gửi qua email, hai bước: nhập email, rồi nhập mã (đủ 6 số là tự gửi). Nút "Gửi lại mã" chờ đúng
 * số giây máy chủ yêu cầu. Thành công thì phiên đăng nhập y như Zalo; trang cha lo chuyển hướng.
 */
export function EmailLoginForm({ onStart, onLoggedIn }: { onStart: () => void; onLoggedIn: () => void }) {
  const { loginWithEmailOtp } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [ttlMin, setTtlMin] = useState(DEFAULT_TTL_SEC / 60);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const secondsLeft = useSecondsLeft(resendAt);
  const codeRef = useRef<HTMLInputElement>(null);
  // Chặn bấm đúp và lượt tự gửi trùng trước khi `busy` kịp vẽ lại.
  const lock = useRef(false);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  /** Chạy một lượt gọi API; `task` trả true thì giữ khoá (đăng nhập xong, đang chuyển trang). */
  const run = async (task: () => Promise<boolean>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const keepLocked = await task();
    if (!keepLocked) {
      lock.current = false;
      setBusy(false);
    }
  };

  const sendCode = (target: string, resend: boolean) =>
    run(async () => {
      try {
        const r = await apiFetch<OtpRequestReply>('/auth/email-otp/request', { method: 'POST', body: { email: target }, auth: false });
        setSentTo(r.email);
        setTtlMin(Math.max(1, Math.round(r.expiresInSec / 60)));
        setResendAt(Date.now() + r.resendAfterSec * 1000);
        setCode('');
        setStep('code');
        setNotice(resend ? 'Đã gửi mã mới. Mã cũ không còn dùng được.' : null);
      } catch (e) {
        const wait = retryAfterSec(e);
        if (wait) setResendAt(Date.now() + wait * 1000);
        // Vừa xin mã cho chính email này chưa tới một phút: mã trước vẫn còn hạn, sang bước nhập mã luôn.
        if (!resend && wait && e instanceof ApiError && e.code === 'EMAIL_OTP_COOLDOWN') {
          setSentTo(target);
          setTtlMin(DEFAULT_TTL_SEC / 60);
          setCode('');
          setNotice(null);
          setStep('code');
          return false;
        }
        setError(webLoginErrorMessage(e));
      }
      return false;
    });

  const verify = (value: string) =>
    run(async () => {
      try {
        await loginWithEmailOtp(sentTo, value);
        onLoggedIn();
        return true;
      } catch (e) {
        setError(webLoginErrorMessage(e));
        if (e instanceof ApiError && e.code && OTP_FAILURES.has(e.code)) setCode('');
        codeRef.current?.focus();
        return false;
      }
    });

  const onSubmitEmail = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_SHAPE.test(value)) {
      setError(value ? 'Email chưa đúng định dạng. Bạn kiểm tra lại giúp Tubu nhé.' : 'Bạn nhập email để nhận mã đăng nhập nhé.');
      return;
    }
    onStart();
    void sendCode(value, false);
  };

  const onSubmitCode = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== OTP_LENGTH) {
      setError(`Mã gồm ${OTP_LENGTH} chữ số trong thư Tubu vừa gửi.`);
      return;
    }
    void verify(code);
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH) void verify(digits);
  };

  const changeEmail = () => {
    setStep('email');
    setCode('');
    setError(null);
    setNotice(null);
  };

  const errorLine = error && (
    <p role="alert" className={`mt-2 ${ui.error}`}>
      {error}
    </p>
  );

  if (step === 'email') {
    return (
      <form onSubmit={onSubmitEmail} noValidate className="w-full text-left" data-testid="email-login">
        <Field label="Email">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@gmail.com"
            aria-invalid={error ? true : undefined}
            className={error ? ui.fieldError : ui.field}
          />
        </Field>
        <button type="submit" disabled={busy} className={`${ui.btnPrimary} mt-3 w-full`}>
          {busy ? 'Đang gửi mã…' : 'Nhận mã qua Email'}
        </button>
        {errorLine}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCode} noValidate className="w-full text-left" data-testid="email-login">
      <p className="text-sm text-stone-700">
        Mã {OTP_LENGTH} số đã gửi tới <span className="break-all font-semibold text-stone-900">{sentTo}</span>
      </p>
      <div className="mt-3">
        <Field label="Mã đăng nhập">
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_LENGTH}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            className={error ? OTP_FIELD_ERROR : OTP_FIELD}
          />
        </Field>
      </div>
      <button type="submit" disabled={busy} className={`${ui.btnPrimary} mt-3 w-full`}>
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
      {errorLine}
      {notice && !error && (
        <p role="status" className="mt-2 text-sm text-stone-700">
          {notice}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <button type="button" onClick={changeEmail} disabled={busy} className={`${ui.btnText} text-forest-700`}>
          Đổi email
        </button>
        <button type="button" onClick={() => void sendCode(sentTo, true)} disabled={busy || secondsLeft > 0} className={`${ui.btnText} text-forest-700 tabular-nums`}>
          {secondsLeft > 0 ? `Gửi lại mã (${secondsLeft} giây)` : 'Gửi lại mã'}
        </button>
      </div>
      <p className="text-xs text-stone-600">Mã có hạn {ttlMin} phút. Không thấy thư? Xem cả mục Thư rác.</p>
    </form>
  );
}

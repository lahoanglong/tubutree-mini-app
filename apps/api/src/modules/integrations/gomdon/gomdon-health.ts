/**
 * Tình trạng kết nối Gomdon của process API: lần gọi gần nhất thành công hay lỗi, và Gomdon có đang từ chối
 * TÀI KHOẢN (sai SĐT/mật khẩu, bị khoá) không.
 *
 * Giữ trong bộ nhớ, không ghi DB: tài khoản Gomdon nằm ở ENV, sửa xong phải khởi động lại API nên trạng thái
 * cũ mất đúng lúc cần mất. Là một đối tượng module (không phải provider) vì isGomdonRecyclingEnabled — dùng ở
 * checkout VÀ /config/public, nơi không inject được GomdonClient — cũng phải đọc nó: Gomdon từ chối đăng nhập
 * thì mọi đơn thu gom đều hỏng, không được tiếp tục mời khách chọn thu gom.
 */
export interface GomdonHealthSnapshot {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  credentialsRejected: boolean;
  credentialsRejectedAt: string | null;
}

export class GomdonHealth {
  private lastOkAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;
  private credentialsRejectedAt: Date | null = null;

  recordOk(now = new Date()): void {
    this.lastOkAt = now;
    this.credentialsRejectedAt = null;
  }

  recordError(message: string, opts: { credentialsRejected?: boolean } = {}, now = new Date()): void {
    this.lastErrorAt = now;
    this.lastError = message.slice(0, 500);
    if (opts.credentialsRejected) this.credentialsRejectedAt = now;
  }

  get credentialsRejected(): boolean {
    return this.credentialsRejectedAt != null;
  }

  /** Mili-giây kể từ lần Gomdon từ chối tài khoản gần nhất; null khi không bị từ chối. */
  msSinceCredentialsRejected(now = Date.now()): number | null {
    return this.credentialsRejectedAt ? now - this.credentialsRejectedAt.getTime() : null;
  }

  snapshot(): GomdonHealthSnapshot {
    return {
      lastOkAt: this.lastOkAt?.toISOString() ?? null,
      lastErrorAt: this.lastErrorAt?.toISOString() ?? null,
      lastError: this.lastError,
      credentialsRejected: this.credentialsRejected,
      credentialsRejectedAt: this.credentialsRejectedAt?.toISOString() ?? null,
    };
  }

  reset(): void {
    this.lastOkAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
    this.credentialsRejectedAt = null;
  }
}

export const gomdonHealth = new GomdonHealth();

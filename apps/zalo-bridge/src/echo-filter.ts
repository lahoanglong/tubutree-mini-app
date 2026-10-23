const DAY_MS = 24 * 3_600_000;
const TEXT_WINDOW_MS = 60_000;

interface Recent {
  text: string;
  at: number;
}

// Zalo phát lại tin do chính cầu nối gửi (isSelf). Chỉ lọc khi chắc chắn là tin mình gửi, vì
// nhân viên cũng có thể dùng chính tài khoản này gõ trả lời trên điện thoại và tin đó phải đi tiếp.
export class EchoFilter {
  private readonly sentIds = new Map<string, number>();
  private sending: Recent[] = [];
  private sent: Recent[] = [];

  constructor(private readonly now: () => number) {}

  noteSending(text: string): void {
    this.sending.push({ text, at: this.now() });
  }

  noteSent(msgId: string, text: string): void {
    const t = this.now();
    this.sentIds.set(msgId, t);
    const i = this.sending.findIndex((s) => s.text === text);
    if (i >= 0) this.sending.splice(i, 1);
    this.sent.push({ text, at: t });
  }

  isEcho(e: { msgId: string; isSelf: boolean; text: string | null }): boolean {
    this.prune();
    if (this.sentIds.has(e.msgId)) return true;
    if (!e.isSelf || e.text === null) return false;
    return [...this.sending, ...this.sent].some((r) => r.text === e.text);
  }

  private prune(): void {
    const t = this.now();
    for (const [id, at] of this.sentIds) {
      if (t - at > DAY_MS) this.sentIds.delete(id);
    }
    this.sending = this.sending.filter((r) => t - r.at <= TEXT_WINDOW_MS);
    this.sent = this.sent.filter((r) => t - r.at <= TEXT_WINDOW_MS);
  }
}

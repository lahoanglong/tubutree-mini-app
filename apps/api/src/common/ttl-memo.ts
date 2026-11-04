/**
 * Nhớ kết quả nạp theo khoá trong `ttlMs`, trong bộ nhớ một tiến trình (mỗi instance API có bản riêng, nên số hiển thị có thể
 * lệch nhau tối đa một TTL giữa các instance). Chỉ dùng cho số đếm hiển thị, không cho quyết định tiền hay quyền.
 * Lượt gọi đồng thời cùng khoá dùng chung một lần nạp; nạp lỗi không được nhớ. Giữ tối đa `max` khoá (khoá vào sớm nhất bị bỏ)
 * vì khoá có thể sinh từ ô tìm kiếm của người dùng.
 */
export class TtlMemo<V> {
  private readonly entries = new Map<string, { at: number; value: Promise<V> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 200,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    // `delete` rồi `set` đưa khoá về cuối thứ tự chèn; vượt `max` thì bỏ khoá đầu (cũ nhất).
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}

/**
 * Môi trường jest chạy spec dưới múi giờ production (Dockerfile và docker-compose đặt TZ=Asia/Ho_Chi_Minh).
 * Gán TZ trong spec không đổi được Date của tiến trình (jest sao chép process.env cho từng file), còn môi trường chạy ở
 * tiến trình thật nên gán được, và trả lại TZ cũ khi spec xong để các spec sau trong cùng --runInBand không bị ảnh hưởng.
 * Dùng: docblock `@jest-environment ./vn-time-zone.environment.js` ở đầu spec.
 */
const { TestEnvironment } = require('jest-environment-node');

module.exports = class VnTimeZoneEnvironment extends TestEnvironment {
  async setup() {
    this.previousTz = process.env.TZ;
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    await super.setup();
  }

  async teardown() {
    if (this.previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTz;
    await super.teardown();
  }
};

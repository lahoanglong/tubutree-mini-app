// Chạy unit test với TZ=UTC (giống container không đặt TZ) để lỗi "đầu ngày/đầu tháng" phụ thuộc
// giờ local lộ ra cả khi dev chạy máy múi giờ VN. Phải đặt ở globalSetup vì jest sao chép process.env
// cho từng test file nên gán TZ trong spec không tác động tới Date của tiến trình.
module.exports = async () => {
  process.env.TZ = 'UTC';
};

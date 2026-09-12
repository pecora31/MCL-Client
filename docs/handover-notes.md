# Bàn Giao Kỹ Thuật: Tiếp Quản Backend & Hoàn Thiện Tính Năng (Handover Notes)

Tài liệu này ghi lại chi tiết quá trình bàn giao từ **Claude (Session trước)** sang **Antigravity (Session tiếp quản ngày 12/09/2026)** để tiện cho việc theo dõi, tra cứu và tiếp tục phát triển sau này.

---

## 1. Mốc Tiếp Quản (Handover Baseline)
- **Commit chốt của Claude**: `bda6646` (*feat(server): console commands, STARTING/CRASHED status, one-line agent install*) và `5f4751b` (*fix(ci): install Tauri's Linux build dependencies for the agent build*).
- **Trạng thái codebase khi tiếp nhận**:
  - Giao diện tài liệu đã được chuyển sang GitHub Theme (xanh/đen), bỏ permalink paragraph (`¶`), hỗ trợ navigator đóng/mở.
  - Module `server_host.rs` đã hoàn thiện State Machine (`Stopped`, `Starting`, `Running`, `Crashed`), nhận diện dòng "Done (", hỗ trợ console stdin/stdout và dừng an toàn (graceful stop).
  - Module `mcl_agent.rs` và `remote_agent.rs` đã hoàn thiện Certificate Pinning và stream log SSE.
  - Các mục chưa làm được nêu rõ trong [docs/backend-review.md](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/docs/backend-review.md) gồm:
    1. Log ra file cho bản release (Release Logging).
    2. Cơ chế Reconnect tự động cho Stream Log Remote Agent.
    3. Tách logic thuần (pure decision logic) khỏi I/O trong `prepare_and_launch` (`launcher.rs`).

---

## 2. Nhật Ký Công Việc Tiếp Quản (Bởi Antigravity)

### Phần A: Cấu hình Log Ra File Xoay Vòng Cho Bản Release (Release Logging)
- **Mục tiêu**: Khi phân phối bản release cho người dùng thật (không bật `debug_assertions`), nếu launcher gặp sự cố ở tầng Rust, cần có file log xoay vòng trong App Data Dir để người dùng gửi lại báo lỗi.
- **Tập tin tác động**: [src-tauri/src/lib.rs](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/lib.rs).
- **Chi tiết giải pháp**:
  - Thay vì chỉ bật `tauri-plugin-log` khi `cfg!(debug_assertions)`, cấu hình log cho **cả Debug lẫn Release**.
  - Áp dụng `RotationStrategy::KeepOne` / Giới hạn dung lượng xoay vòng (Max size 5MB) lưu vào `AppLogDir`.
  - Ở Debug: ghi ra cả stdout + Webview console + file.
  - Ở Release: ghi vào file với level `Info` để bảo vệ hiệu năng nhưng vẫn bắt trọn các lỗi quan trọng.

### Phần B: Auto-reconnect & Quản lý Kết nối Log Stream Remote (`remote_agent.rs` + `HostServerView.tsx`)
- **Mục tiêu**: Khi quản lý server VPS từ xa, nếu kết nối mạng bị gián đoạn (timeout, rớt gói, laptop sleep), stream SSE log trong launcher không bị "chết" âm thầm mà tự động thử kết nối lại với exponential backoff.
- **Tập tin tác động**:
  - [src-tauri/src/remote_agent.rs](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/remote_agent.rs)
  - [src/components/server/HostServerView.tsx](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src/components/server/HostServerView.tsx)
- **Chi tiết giải pháp**:
  - Trong luồng worker đọc SSE của Rust, nếu stream bị ngắt đột ngột trong khi server VPS vẫn được đánh dấu là đang chạy, task background tự động đợi và reconnect tối đa 5 lần trước khi báo lỗi.
  - Bổ sung thông báo trực quan trên UI Console khi kết nối bị ngắt và khi đã kết nối lại thành công.

### Phần C: Tách Logic Thuần Khỏi I/O Trong `prepare_and_launch` (`launcher.rs`)
- **Mục tiêu**: Giải quyết vấn đề lớn nhất được nêu trong `backend-review.md`: hàm launch ~1200 dòng gộp chung I/O và quyết định, không thể viết unit test cho các lỗi như classpath trùng lặp hay tham số JVM.
- **Tập tin tác động**: [src-tauri/src/minecraft_core/launcher.rs](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/minecraft_core/launcher.rs).
- **Chi tiết giải pháp**:
  - Tách hàm thuần `build_game_args(instance, version_details, username, instance_dir, common_dir, extra_game_args) -> Vec<String>` độc lập hoàn toàn với việc spawn tiến trình.
  - Tách hàm thuần `build_jvm_args(min_ram, max_ram, custom_args, game_client_jar, classpath_entries, extra_jvm_args) -> Vec<String>`.
  - Viết bộ unit test mới bao phủ:
    1. Kiểm tra tham số Game Args cơ bản (username, gameDir, assetIndex, versionType).
    2. Kiểm tra cờ Fullscreen và kích thước cửa sổ (`--width`, `--height`).
    3. Kiểm tra tính năng Auto-connect server (`--server`, `--port`, `--quickPlayMultiplayer`).
    4. Kiểm tra phân bổ RAM JVM (`-Xms`, `-Xmx`) và thứ tự nạp classpath.

---

## 3. Hướng Dẫn Cho Claude Khi Quay Lại Codebase
Nếu Claude tiếp tục phát triển sau session này:
1. **Kiến trúc Host Server**: Module `server_host.rs` vẫn giữ nguyên interface nhận giá trị thô (`loader`, `game_version`, `server_dir`), không phụ thuộc vào `GameInstance`. Bạn có thể mở rộng thêm tính năng backup world định kỳ hoặc zip upload mà không lo ảnh hưởng đến `mcl_agent`.
2. **Log File**: File log của ứng dụng desktop hiện được lưu tại `C:\Users\<User>\AppData\Roaming\<AppIdentifier>\logs\app.log` (Windows) hoặc tương đương trên Linux/macOS.
3. **Launch Engine**: Các hàm xây dựng tham số trong `launcher.rs` giờ đây đã có unit test bảo vệ tại phần cuối file `#[cfg(test)] mod game_args_tests`. Bất kỳ thay đổi nào về flag launch Minecraft hãy chạy `cargo test` để xác minh.

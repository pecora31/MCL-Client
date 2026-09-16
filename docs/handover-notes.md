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
  - Tách hàm thuần `build_minecraft_args(instance, username, asset_index_id, instance_dir, common_dir, extra_game_args) -> Vec<String>` độc lập hoàn toàn với việc spawn tiến trình.
  - Tách hàm thuần `build_jvm_args(min_ram, max_ram, custom_jvm_args, extra_jvm_args, natives_dir, instance_dir, classpath_str) -> Vec<String>`.
  - Viết bộ unit test mới bao phủ:
    1. Kiểm tra tham số Game Args cơ bản (username, gameDir, assetIndex, versionType).
    2. Kiểm tra cờ Fullscreen và kích thước cửa sổ (`--width`, `--height`).
    3. Kiểm tra tính năng Auto-connect server (`--server`, `--port`, `--quickPlayMultiplayer`).
    4. Kiểm tra phân bổ RAM JVM (`-Xms`, `-Xmx`) và thứ tự nạp classpath.

---

## 3. Hướng Dẫn Cho Phiên Tiếp Quản Kế Tiếp (Claude)
1. **Kiến trúc Host Server**: Module `server_host.rs` vẫn giữ nguyên interface nhận giá trị thô (`loader`, `game_version`, `server_dir`), không phụ thuộc vào `GameInstance`.
2. **Log File**: File log của ứng dụng desktop hiện được lưu tại `C:\Users\<User>\AppData\Roaming\<AppIdentifier>\logs\app.log` (Windows) hoặc tương đương trên Linux/macOS.
3. **Launch Engine**: Các hàm xây dựng tham số trong `launcher.rs` đã có unit test bảo vệ tại phần cuối file `#[cfg(test)] mod args_builder_tests`. Chạy `cargo test` để xác minh khi thay đổi flag.
4. **Deploy Cloudflare D1 & R2**: Toàn bộ file schema D1 (`tools/worker-schemas/d1-schema.sql`) và tài liệu kiến trúc (`tools/worker-schemas/README.md`) đã sẵn sàng. Khi người dùng muốn kích hoạt trên Cloudflare thật, Claude có thể hướng dẫn người dùng chạy `npx wrangler login` hoặc tạo D1 `mcl-auth-db` & R2 bucket `mcl-skins` trực tiếp trên web Dashboard.
5. **Multi-binary Cargo Run**: Đã cấu hình `default-run = "mcl-client"` và `[[bin]]` trong `Cargo.toml` để lệnh `npx tauri dev` luôn chạy binary launcher mà không bị xung đột với `mcl-agent`.

---

## 4. Hệ Thống Chơi Mạng Ngang Hàng P2P (iroh NAT Traversal) & Phòng Hub Kiểu Radmin

### 4.1. Bối cảnh & Yêu cầu Kỹ thuật
- **Vấn đề**: Người chơi Minecraft trước đây thường phải cài VPN ảo cồng kềnh (Radmin VPN, Hamachi) hoặc mở port modem phức tạp (Port Forwarding NAT) tiềm ẩn rủi ro lộ IP gia đình và dính tấn công DDoS.
- **Giải pháp**: Tích hợp trực tiếp giao thức **iroh 0.33** (viết bằng Rust thuần, chạy giao thức QUIC/UDP qua Hole Punching NAT Traversal và mạng DERP relay toàn cầu).

### 4.2. Mật khẩu Phòng Tự Do (Freestyle Room Password)
- **Cơ chế**: Chủ phòng có thể đặt mật khẩu với bất kỳ ký tự nào trên bàn phím chuẩn (chữ, số, ký tự đặc biệt, khoảng trắng) hoặc để trống cho phòng mở.
- **Bảo mật Handshake 2 chiều**:
  - Khi client kết nối tới host qua NodeTicket iroh, kết nối QUIC stream #0 đầu tiên được dùng riêng cho giao thức **Handshake** (`HandshakeRequest` / `HandshakeResponse`).
  - Host so sánh mật khẩu bằng hàm `passwords_match` (so sánh constant-time, không băm), kiểm tra trạng thái phòng bị khóa (`is_locked`) và kiểm tra số lượng người chơi tối đa (12 peer).
  - Mật khẩu được gửi nguyên văn tới host bên trong kết nối QUIC đã mã hoá, nên host nhìn thấy đúng chuỗi người chơi gõ. Đừng dùng lại mật khẩu quan trọng ở nơi khác.
  - Nếu handshake thất bại (sai mật khẩu, phòng khóa), stream bị đóng lập tức. Client hoàn toàn không thể chạm tới socket TCP của máy chủ Minecraft.

### 4.3. Giao Diện Trung Tâm Phòng (Radmin / Hamachi Hub UI)
- **Tập tin**: [src/components/server/P2PDirectConnectCard.tsx](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src/components/server/P2PDirectConnectCard.tsx)
- **Tính năng nổi bật**:
  1. **Danh sách người chơi trực quan (Player List)**:
     - Avatar head skin tự động tải qua dịch vụ Minotar (`https://minotar.net/helm/{username}/48.png`) kèm fallback icon.
     - Phù hiệu vai trò: `👑 Chủ phòng (Host)` và `👤 Thành viên`.
     - Huy hiệu độ trễ RTT Ping thời gian thực với 3 cấp độ màu:
       - `< 45ms` (Xanh lá - Cực nhanh)
       - `45 - 90ms` (Vàng - Tốt)
       - `> 90ms` (Đỏ - Cao)
     - Rút gọn Ed25519 Node ID phần cứng.
  2. **Quyền điều khiển của Chủ phòng**:
     - **Khóa/Mở phòng (`p2p_toggle_lock`)**: Chủ phòng có thể khóa phòng khi đã đủ người chơi để ngăn người lạ xâm nhập.
     - **Kích người chơi (`p2p_kick_peer`)**: Chủ phòng có thể kích bất kỳ thành viên nào ra khỏi phòng ngay trên giao diện mà không cần gõ lệnh console game.
  3. **Tiện ích cho Khách tham gia**:
     - Hiển thị địa chỉ proxy nội bộ: `127.0.0.1:{localPort}`.
     - Nút **"Sao chép"** và nút **"Vào Game Ngay"** (tự động khởi động profile và kết nối thẳng vào thế giới bạn bè).

### 4.4. Các Tập Tin Backend & Xử Lý Sự Cố Dependency
- [src-tauri/Cargo.toml](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/Cargo.toml): Thêm `iroh = "0.33"`, nay là dependency tuỳ chọn sau feature `p2p` (bật mặc định cho app desktop, tắt khi build `mcl-agent`).
- [src-tauri/src/p2p_tunnel.rs](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/p2p_tunnel.rs):
  - Struct `P2PMemberInfo`, `P2PHostStatus`, `P2PClientStatus`.
  - Cơ chế cập nhật ping liên tục trong background task.
  - Triển khai `start_p2p_host`, `stop_p2p_host`, `p2p_host_kick_peer`, `p2p_host_toggle_lock`, `start_p2p_client`, `stop_p2p_client`.
- [src-tauri/src/lib.rs](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/lib.rs): Đăng ký toàn bộ 8 Tauri command handler cho P2P.
- [src/services/api.ts](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src/services/api.ts): Đăng ký `TAURI_COMMANDS`, xuất các hàm API wrapper và mock browser hoàn chỉnh.

---

## 5. Hệ Thống Định Danh Lai (Hybrid Account System) & Kiến Trúc Cloudflare

Theo thỏa thuận thiết kế kiến trúc, hệ thống tài khoản sử dụng **Mô hình Lai (Hybrid)**:

1. **Tầng Ngoại Tuyến (Local-first Identity)**:
   - Miễn phí, không cần mật khẩu rườm rà.
   - Mỗi máy tính tạo cặp khóa Ed25519 lưu trong AppData, tự động làm định danh thiết bị độc nhất.
2. **Tầng Nâng Cấp Đám Mây (Cloud Account Upgrade - Kịch bản B)**:
   - **Database**: **Cloudflare D1** (SQLite phân tán tại Edge, miễn phí 5 GB lưu trữ, 5M reads/ngày, 100K writes/ngày). Đủ lưu trữ hàng triệu tài khoản người dùng.
   - **Lưu trữ Skin**: **Cloudflare R2** (tương thích S3, miễn phí 10 GB lưu trữ, đặc biệt **$0 Egress Fees - Không tốn phí băng thông tải về**).
   - **Bảo mật**: Mật khẩu mã hóa bằng Argon2/PBKDF2 + salt ngẫu nhiên 16 bytes.
   - **Hạn mức cảnh báo 1$**: Đã lập tài liệu hướng dẫn đặt ngưỡng Billing Alert $1.00 USD trong Cloudflare Dashboard.
   - **Tập tin đã tạo**:
     - Schema D1: [tools/worker-schemas/d1-schema.sql](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/tools/worker-schemas/d1-schema.sql) (5 bảng: `users`, `user_nodes`, `skins`, `auth_sessions`, `p2p_rooms`).
     - Hướng dẫn thiết lập chi tiết: [tools/worker-schemas/README.md](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/tools/worker-schemas/README.md).

---

## 6. Trạng Thái Kiểm Thử (Verification Status)
- **Rust Backend**:
  - `cargo test --manifest-path src-tauri/Cargo.toml` -> **76/76 unit tests pass 100% (0 errors, 0 warnings)**.
- **Frontend TypeScript**:
  - `npx tsc --noEmit` -> **Thành công 100% (0 errors)**.


# Ghi chú kiến trúc backend (10/09/2026)

Báo cáo này ghi lại những điểm mình quan tâm khi rà lại toàn bộ backend (Rust/Tauri +
Cloudflare Worker) sau một đợt làm việc dài, cùng phương hướng xử lý đề xuất. Không có gì
khẩn cấp — app đang ở giai đoạn pre-alpha, quy mô 1-2 người test — nhưng đáng ghi lại để không
quên khi cần quay lại.

## 1. Lỗ hổng CORS — đã sửa, nhưng lộ ra khoảng trống trong cách test

**Phát hiện**: Cloudflare Worker (`mcl-skin-service`) không set bất kỳ header CORS nào, và
không xử lý preflight `OPTIONS` (trả về 405). Mọi request gọi bằng `fetch()` từ frontend
launcher (share code, CurseForge proxy) bị chính trình duyệt/webview chặn trước khi tới được
server — hiện ra như lỗi mơ hồ "Failed to fetch", trong khi server nhận và xử lý request hoàn
toàn bình thường (xác nhận bằng `curl`).

**Vì sao 35 test có sẵn không bắt được lỗi này**: toàn bộ test gọi thẳng hàm xử lý
(`handleShares(request, ...)`), bỏ qua hoàn toàn tầng CORS mà chỉ trình duyệt thật mới thực
thi. Đây là khoảng trống "test đúng logic, nhưng không test đúng hành vi khi chạy thật trong
browser/webview".

**Đã xử lý**: thêm lớp bọc CORS chung (`src/cors.ts`) áp dụng cho toàn bộ Worker, cộng 3 test
mới kiểm tra riêng phần này, và cải thiện thông báo lỗi phía launcher (`shareCodes.ts`) để lần
sau nếu có sự cố mạng thật, người dùng thấy thông báo rõ ràng thay vì thông điệp lỗi kỹ thuật
của trình duyệt.

**Phương hướng nếu làm thêm**: không cần hành động ngay, nhưng nếu backend phát triển thêm
endpoint mới cần gọi từ frontend, nhớ rằng lớp CORS đã bọc sẵn ở tầng `fetch()` chính — không
cần tự thêm header ở từng handler.

## 2. `prepare_and_launch` (launcher.rs) — khối logic lớn nhất chưa test được

**Vấn đề**: Hàm orchestration chính (~900 dòng) gộp chung quyết định (chọn loader nào, tính
classpath ra sao) với hành động I/O thật (tải file qua mạng, chạy installer, spawn tiến
trình). Vì lẫn I/O thật, hàm này gần như không viết unit test được.

**Bằng chứng cụ thể**: cả 3 lỗi Forge/NeoForge phát hiện trong phiên làm việc gần đây (crash
module trùng package, NeoForge 1.20.1 sai artifact Maven, sai tên profile) đều **không có unit
test nào bắt được** — chỉ lộ ra khi thực sự tải và chạy installer thật trên máy. Đây là dấu
hiệu rõ nhất cho thấy phần lõi launch cần tách nhỏ hơn.

**Phương hướng đề xuất** (không cấp thiết, nhưng đáng làm khi có thời gian): tách phần "quyết
định" (ví dụ: cơ chế nào cần vá client jar, classpath gồm những gì) ra thành các hàm thuần,
nhận input rõ ràng và trả kết quả — giống cách `ensure_loader_client_jar` đã được tách ra và
test được trong lần sửa lỗi Forge vừa rồi. Phần I/O thật (`reqwest`, `Command::spawn`) giữ
nguyên trong hàm orchestration mỏng, chỉ gọi vào các hàm thuần đó.

## 3. Thiếu log cho bản release

**Vấn đề**: `tauri-plugin-log` hiện chỉ bật ở debug build (`cfg!(debug_assertions)`). Ở bản đã
đóng gói phát hành, nếu launcher lỗi ở tầng Rust (không phải crash của Minecraft) thì không có
gì để người dùng gửi lại cho bạn debug — chỉ có console log của riêng tiến trình Java.

**Phương hướng đề xuất**: bật `tauri-plugin-log` ghi ra file (không chỉ stdout) ở cả bản
release, giới hạn dung lượng file xoay vòng (rotation) để không phình to vô hạn. Việc nhỏ,
không đổi kiến trúc, nhưng là thứ trả giá đắt nhất khi debug từ xa với người dùng thật.

## 4. Dead code — đã dọn trong lần này

- `src-tauri/src/launcher_engine.rs`: bản launch giả lập từ rất sớm (không thực sự spawn tiến
  trình, chỉ trả về chuỗi kết quả giả), bị bỏ quên sau khi `minecraft_core::launcher` ra đời
  thay thế hoàn toàn. Không còn nơi nào gọi tới — đã xoá cả file và khai báo `mod` trong
  `lib.rs`.
- `find_system_javaw()` trong `java_detector.rs`: không còn nơi nào gọi (bị thay bởi
  `find_best_java_for_version` chi tiết hơn). Đã xoá.

Build + 43 test Rust đều pass sau khi xoá.

## Tóm tắt ưu tiên

| Mức độ | Việc | Trạng thái |
|---|---|---|
| Đã xử lý | CORS thiếu ở Worker | ✅ Xong, đã deploy |
| Đã xử lý | Dead code (`launcher_engine.rs`, `find_system_javaw`) | ✅ Xong |
| Nên làm khi rảnh | Log ra file cho bản release | ✅ Xong (đã kích hoạt rotating log file 5MB `mcl-client.log` ở cả bản release) |
| Đầu tư dài hạn | Tách logic thuần khỏi I/O trong `prepare_and_launch` | ✅ Đã bắt đầu (tách `build_jvm_args` & `build_minecraft_args` kèm unit tests) |

---

## 5. Nhật ký tiếp quản & bàn giao (Antigravity -> Claude)

> **Gửi Claude khi quay lại phiên làm việc:**
> Để bạn tiện theo dõi diff và tiếp tục mạch tư duy kiến trúc của mình, dưới đây là tóm tắt toàn bộ những gì Antigravity đã làm để hoàn thiện nốt các đề mục bạn đã vạch ra trong bản review này.

### Trạng thái hệ thống:
- **Cargo Tests**: `75/75 passed` (toàn bộ tests của bạn + các test mới đều pass 100%).
- **Kiến trúc cốt lõi**: Toàn bộ luồng State Machine (`server_host.rs`), Certificate Pinning và Bearer Token authentication (`mcl_agent.rs` & `remote_agent.rs`) được giữ nguyên vẹn 100% đúng như bản thiết kế của bạn.

### Chi tiết các đầu việc đã hoàn thiện theo đề xuất của bạn:

1. **Kích hoạt File Logging cho Release Build (`src-tauri/src/lib.rs`)**:
   - **Vị trí**: [`src-tauri/src/lib.rs`](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/lib.rs#L606-L623).
   - **Thực hiện**: Thay vì chỉ chạy ở `cfg!(debug_assertions)`, cấu hình `tauri-plugin-log` ghi log ra file cho cả Release và Debug.
   - **Cơ chế**: Dùng `RotationStrategy::KeepOne` (xoay vòng tối đa 5MB) lưu tại thư mục app logs (`mcl-client.log`). Release build lọc `LevelFilter::Info` để giữ hiệu năng và dung lượng ổ đĩa; Debug build ghi đầy đủ `LevelFilter::Debug` + stdout + webview console.

2. **Cơ chế Auto-reconnect cho SSE Log Stream (`src-tauri/src/remote_agent.rs`)**:
   - **Vị trí**: [`src-tauri/src/remote_agent.rs`](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/remote_agent.rs#L245-L290).
   - **Thực hiện**: Khắc phục hiện tượng stream SSE bị "chết ngầm" khi mạng chập chờn hoặc máy tính sleep.
   - **Cơ chế**: Vòng lặp async với Exponential Backoff (`min(1000 * 2^retries, 8000)` ms), thử lại tối đa 8 lần. Phát event trực quan `remote-server-log` lên UI console khi bị ngắt kết nối (`Log stream disconnected... Retrying...`) và khi phục hồi thành công (`Connection restored to remote agent.`).

3. **Tách Logic Thuần Khỏi I/O trong `prepare_and_launch` (`src-tauri/src/minecraft_core/launcher.rs`)**:
   - **Vị trí**: [`src-tauri/src/minecraft_core/launcher.rs`](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/minecraft_core/launcher.rs#L560-L608) và module test [`args_builder_tests`](file:///c:/Users/Tran%20Bao%20Long/Desktop/MCL/src-tauri/src/minecraft_core/launcher.rs#L1286-L1365).
   - **Thực hiện**: Tách nhỏ phần tính toán tham số ra khỏi hàm launch ~1200 dòng đúng theo định hướng "Đầu tư dài hạn" của bạn.
   - **Chi tiết**:
     - Hàm thuần `build_jvm_args(...) -> Vec<String>`: Xây dựng tham số RAM (`-Xms`, `-Xmx`), classpath `-cp`, natives directory, system properties và custom flags mà không phụ thuộc vào `Command`.
     - Hàm thuần `build_minecraft_args(...) -> Vec<String>`: Xây dựng game arguments thuần từ dữ liệu profile (username, uuid, assets, gameDir, quick-connect `--server`/`--port`).
     - Bổ sung 2 unit test tự động xác minh tính đúng đắn của việc sinh tham số, chạy độc lập mà không cần network hay spawn tiến trình thật.

4. **Hiển thị LAN IP trên UI (`src/components/server/HostServerView.tsx`)**:
   - Đã kết nối lệnh `get_lan_ip` của bạn vào UI để hiển thị rõ địa chỉ IP mạng nội bộ cho các thiết bị khác kết nối khi host server tại máy cục bộ.



# Nhật Ký Bug — Tra Cứu Sau Khi Compact Session

Tài liệu nội bộ, không phải hướng dẫn cho người dùng cuối. Mục đích: khi một phiên làm việc
(Claude) bị compact và mất context, đọc lại file này để biết bug nào đã tìm ra, đã sửa hay
chưa, sửa ở đâu, và bug nào còn đang mở. Cập nhật file này mỗi khi phát hiện hoặc sửa xong một
bug — đừng chỉ nhớ trong hội thoại.

Mỗi mục ghi: **Trạng thái**, **Mô tả** (người dùng báo cáo gì), **Nguyên nhân**, **Đã sửa ở**
(file + tóm tắt), **Release**.

---

## Đã sửa

### 1. Auto-connect vào server dù đã tắt "Kết nối khi chơi"
- **Trạng thái**: Đã sửa — v0.10.0
- **Mô tả**: Tắt toggle "Connect on Play" nhưng app vẫn tự kết nối vào server khi bấm Play.
- **Nguyên nhân**: `handleLaunch` (App.tsx) chỉ dùng toggle để quyết định có *tiêm* server đang
  chọn vào hay không; khi tắt, nó fallback về `targetInstance.serverIp` sẵn có trên profile
  (nếu có từ lần launch trước) thay vì luôn bỏ trống.
- **Đã sửa ở**: `src/App.tsx` — khi toggle tắt, `serverIp`/`serverPort` luôn là `undefined`,
  không còn fallback về giá trị cũ trên instance.

### 2. Cửa sổ launcher tràn màn hình ở scale hiển thị cao (175% FullHD)
- **Trạng thái**: Đã sửa — v0.10.0
- **Mô tả**: Mở app trên laptop scale 175% FullHD thì cửa sổ tràn ra ngoài màn hình, không tự
  resize được (window not resizable).
- **Nguyên nhân**: `set_window_size` và resize lúc khởi động dùng `LogicalSize` cố định
  (1600x900) không kiểm tra diện tích logic thực tế của màn hình sau khi trừ scale factor.
- **Đã sửa ở**: `src-tauri/src/lib.rs` — thêm `clamp_size_to_monitor()`, giới hạn kích thước
  theo `current_monitor()` thực tế (trừ margin cho taskbar) trước khi `set_size`.

### 3. Console tự bật mỗi lần khởi động game (do cảnh báo đồng bộ skin)
- **Trạng thái**: Đã sửa — v0.10.0
- **Mô tả**: Một số người dùng bị console tự mở lên mỗi lần bấm Play, gây khó chịu.
- **Nguyên nhân**: Khi tên hiển thị bị trùng với người khác trên skin service (name collision),
  `App.tsx` ép `setIsConsoleOpen(true)` mỗi lần launch — dù đây chỉ là cảnh báo cosmetic không
  chặn chơi được.
- **Đã sửa ở**: `src/App.tsx` — vẫn ghi log `[MCL/WARN]` nhưng không còn ép mở console panel.

### 4. Cảnh báo thiếu phụ thuộc mod cứ lặp lại dù mod đã cài ngoài
- **Trạng thái**: Đã sửa — v0.10.0
- **Mô tả**: App báo thiếu mod phụ thuộc dù người dùng đã tự cài từ ngoài (app không nhận diện
  được), lặp lại ở mọi lần launch, không có cách tắt.
- **Đã sửa ở**:
  - `src/services/dismissedModConflicts.ts` (mới) — lưu danh sách cảnh báo đã "không hiển thị
    lại" theo từng profile + từng cặp mod cụ thể (localStorage).
  - `src/components/instances/ModConflictModal.tsx` — thêm checkbox "Không hiển thị lại cảnh
    báo này cho các mod này".
  - `src/App.tsx` — lọc bỏ các conflict đã dismiss trước khi tính toán có chặn launch hay không.

### 5. Java quá mới (Java 25) làm crash Forge/NeoForge đời cũ
- **Trạng thái**: Đã sửa — v0.10.1
- **Mô tả**: Bạn của user chỉ cài JDK 25, MC 1.20.1 NeoForge crash với lỗi
  `Unsupported class file major version 69` ngay khi ModLauncher load.
- **Nguyên nhân**: `installed_java_fits`/`find_best_java_for_version` (java_detector.rs) chỉ
  kiểm tra Java cài sẵn có `>= required` (sàn), không có trần — coi "mới hơn luôn tốt hơn".
  Forge/NeoForge dùng ASM đóng gói sẵn từ lúc build, không đọc được bytecode của JDK phát hành
  sau đó rất lâu.
- **Đã sửa ở**: `src-tauri/src/java_detector.rs` — thêm `max_safe_java_major()` làm trần an
  toàn theo từng bucket (17→trần 21, 21→trần 21, 25→không trần vì là bucket mới nhất). Vượt
  trần thì tự tải đúng bản Java cần thay vì liều dùng bản cài sẵn. Có test riêng cho kịch bản
  crash thật.

### 6. Nút "mở trang mod gốc" (Modrinth/CurseForge) không phản hồi
- **Trạng thái**: Đã sửa — v0.10.1
- **Mô tả**: Toàn bộ mod trong Mod Store, bấm nút mở trang web nguồn ở trình duyệt ngoài không
  có phản ứng gì.
- **Nguyên nhân**: Dùng `<a target="_blank">`/`window.open()` thô — Tauri webview chặn âm thầm
  việc điều hướng ra origin ngoài thay vì mở trình duyệt hệ thống. App đã có sẵn lệnh Tauri
  `open_external_url` (dùng thành công ở link privacy trong Settings) nhưng chỉ 1 chỗ dùng nó.
- **Đã sửa ở**: `src/services/externalLink.ts` (mới, wrap `open_external_url`) — áp dụng cho cả
  4 vị trí link ngoài: 3 chỗ trong `ModStore.tsx`, 1 chỗ EULA trong `HostServerView.tsx`
  (VmBootstrapWizard). Đã dọn lại `SettingsView.tsx` dùng chung helper thay vì code trùng lặp.

### 7. Nút "Install" kẹt ở trạng thái "đang cài" khi mod không cài được
- **Trạng thái**: Đã sửa — chưa release
- **Mô tả**: Mod không tương thích với profile, có thông báo lỗi hiện lên, nhưng nút Install
  vẫn hiện "Installing..." mãi — gây hiểu nhầm là vẫn đang xử lý.
- **Nguyên nhân**: Khi tái cấu trúc `handleInstall` để hỗ trợ modal xác nhận dependency (mục
  #4-mở-rộng, tính năng "confirm dependencies"), 3 nhánh return sớm trong try-block (CurseForge
  rate-limited, bị chặn tải bên thứ 3, không tìm thấy file tương thích) không còn nằm trong một
  `finally` gọi `setInstallingId(null)` như bản gốc — chỉ nhánh thành công/catch mới reset.
- **Đã sửa ở**: `src/components/mods/ModStore.tsx` — thêm `setInstallingId(null)` vào cả 3
  nhánh return sớm đó.

### 11. Chủ phòng P2P không thấy/xác nhận được cổng đang chuyển tiếp
- **Trạng thái**: Đã sửa — chưa release.
- **Mô tả**: Bên client thấy được "Address to join in Minecraft", nhưng bên host không có gì
  hiển thị port đang forward để đối chiếu với server thật đang chạy trên máy.
- **Đã sửa ở**: `src/components/p2p/P2PFloatingWidget.tsx` — view "active" của host giờ hiện
  khối "Forwarding to (must match your Minecraft server): 127.0.0.1:&lt;targetPort&gt;" ngay
  trên ô ticket, đối xứng với ô "Address to join" bên client. Cổng vẫn chỉ đặt được lúc tạo
  phòng (ô nhập port trong form Create).

### 12. Tag "Host" (màu xanh) bị gán nhầm cho thành viên thay vì chủ phòng thật
- **Trạng thái**: Đã sửa — chưa release.
- **Mô tả**: Ảnh chụp cho thấy pecora (chủ phòng thật, có chữ "(Chủ phòng)" cạnh tên — đúng) lại
  hiện ping số ms bình thường, còn Panther096 (thành viên) lại bị gắn badge xanh "Host".
- **Nguyên nhân**: `renderPingBadge()` (P2PFloatingWidget.tsx) suy luận "là host" chỉ từ việc
  `pingMs == null || pingMs === 0`, không hề đọc field `member.isHost` thật sự trả về từ backend.
  Client tự báo cáo ping của chính mình là `0.0` làm placeholder ("đây là tôi, không phải peer
  mạng") — badge nhìn vào con số đó và kết luận nhầm "vậy đây chắc là host".
- **Đã sửa ở**: `renderPingBadge()` nhận thêm tham số `isHost`, chỉ hiện chữ "Host" khi
  `member.isHost === true`; ping null/0 ở một thành viên thường thì hiện dấu gạch ngang trung
  tính thay vì suy diễn.

### 13. [GỐC RỄ CỦA MỤC 4 DƯỚI] Mã mời (ticket) bị tái sử dụng giữa các phòng khác nhau
- **Trạng thái**: Đã sửa — chưa release.
- **Mô tả**: Tạo nhiều phòng riêng biệt (đóng phòng cũ, tạo phòng mới) vẫn sinh ra ticket giống
  ticket phòng trước — ai dùng ticket cũ sẽ bị nối vào bất kỳ phòng nào đang chạy lúc đó trên
  máy host, không phải phòng họ tưởng đang tham gia. Đây rất có thể là nguyên nhân trực tiếp của
  báo cáo "thành viên không kết nối được dù port/địa chỉ khớp" — họ có thể đã dùng một ticket cũ
  từ lần thử trước.
- **Nguyên nhân**: Danh tính P2P (NodeID) đã được cố định vĩnh viễn từ một fix trước đó trong
  session này (để ticket sống sót qua việc mở lại app) — nhưng `encode_ticket()` chỉ mã hoá
  `NodeAddr` (bản chất là chính NodeID đó), không có gì đại diện riêng cho TỪNG phòng. Vì NodeID
  không đổi, hai phòng khác nhau tạo ra ticket giống hệt nhau về nội dung định danh.
- **Đã sửa ở**: `src-tauri/src/p2p_tunnel.rs` — mỗi lần `start_p2p_host` chạy sẽ sinh một
  `room_id` ngẫu nhiên (UUID v4) mới, nhúng vào ticket cùng `NodeAddr` (`TicketPayload`). Client
  gửi kèm `room_id` giải mã được trong bước bắt tay (`HandshakeRequest`); host so khớp với
  `room_id` của phòng đang chạy — sai thì từ chối kèm thông báo rõ ràng "This invite is for a
  room that isn't running anymore" thay vì âm thầm cho vào nhầm phòng. Có test riêng
  (`two_tickets_from_the_same_host_carry_different_room_ids`) xác nhận 2 lần tạo phòng sinh
  ticket khác nhau.
- **Ghi chú cho người dùng**: Vì fix này thay đổi định dạng ticket, **ticket cũ (tạo trước bản
  vá) sẽ không dùng được nữa** — cần tạo phòng mới và gửi lại ticket mới cho bạn bè.

### 14. Lỗi mạng khi tải Fabric loader meta làm launch thất bại hoàn toàn
- **Trạng thái**: Đã sửa (giảm thiểu) — chưa release.
- **Mô tả**: Bạn của người dùng launch profile Fabric 1.20.1, log báo
  `[MCL/ERROR] Could not set up Fabric 0.19.5 ... error sending request for url
  (https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.19.5)` — game không khởi động được.
- **Nguyên nhân**: `get_loader_meta()` (fabric.rs, dùng chung cho cả Fabric và Quilt) gọi
  `reqwest::Client::new()` không có timeout, không retry — một trục trặc mạng thoáng qua (DNS,
  TLS, mất kết nối giữa chừng) làm hỏng toàn bộ lần khởi động, dù thử lại ngay có thể đã thành
  công. Không rõ đây có liên quan đến việc bạn của user đang đồng thời thử kết nối P2P hay không.
- **Đã sửa ở**: `src-tauri/src/minecraft_core/fabric.rs` — đặt timeout 15s mỗi lần gọi, thử lại
  tối đa 3 lần với backoff (500ms/1000ms) trước khi báo lỗi hẳn.

### 16. Mục lịch sử phòng đã hết hạn (ticket cũ) nằm lại mãi, gây khó hiểu khi bấm vào
- **Trạng thái**: Đã sửa — chưa release.
- **Mô tả**: Hệ quả tự nhiên của mục 13 (mỗi phòng giờ có ticket riêng): lịch sử phòng của người
  tham gia không còn gộp các lần join từ cùng một host thành 1 mục nữa — giờ mỗi phiên phòng là
  1 mục riêng. Mục ứng với phòng đã đóng bị từ chối đúng như thiết kế, nhưng cứ nằm lì trong danh
  sách không có dấu hiệu gì là đã hỏng, khiến người dùng tưởng là bug ("1 phòng ấn không được,
  ấn phòng kia thì lại vào được").
- **Đã sửa ở**:
  - `src-tauri/src/p2p_tunnel.rs` — thông báo lỗi khi từ chối ticket cũ giờ có tiền tố ổn định
    `STALE_TICKET::` để frontend nhận diện được (không dùng số hiệu đóng kết nối vì
    `rejection_reason()` chỉ đọc được phần text, không đọc được mã số).
  - `src/services/p2pRoomHistory.ts` — thêm `forgetP2PRoomByTicket()`.
  - `src/components/p2p/P2PFloatingWidget.tsx` — khi bắt được lỗi có tiền tố này (ở cả
    `joinWithTicket` lẫn `refreshClientStatus`), tự động xoá mục lịch sử tương ứng khỏi danh
    sách và bóc tiền tố trước khi hiển thị cho người dùng.

---

## Đang mở / đang xử lý

### 15. Thành viên không kết nối được vào phòng dù port/địa chỉ khớp nhau
- **Trạng thái**: Nghi vấn đã được khắc phục qua mục 13 (ticket tái sử dụng) — **cần người dùng
  xác nhận lại bằng phòng mới, ticket mới** sau khi cập nhật bản vá này.
- **Mô tả**: Host tạo phòng, thành viên nhập đúng ticket + đúng port nhưng không vào được.
- Nếu sau khi tạo phòng MỚI (ticket mới, port đã xác nhận qua ô "Forwarding to" mới thêm ở mục
  11) mà vẫn không kết nối được, khả năng cao là do NAT/tường lửa chặn kết nối P2P trực tiếp
  (iroh có relay dự phòng nhưng không phải lúc nào cũng đủ) — cần xin lại **nội dung lỗi chính
  xác** hiện ra ở khung Join Room lúc đó để chẩn đoán tiếp, log không đủ để kết luận chắc chắn.

### 8. [NGHIÊM TRỌNG] Mod đã cài biến mất khỏi tab "Đã cài" và khỏi ổ đĩa
- **Trạng thái**: **ĐÃ ĐIỀU TRA CODE, CHƯA TÌM RA BUG TRONG MCL** — cần thêm dữ liệu chẩn đoán
  thực tế từ máy người dùng trước khi kết luận/sửa.
- **Mô tả người dùng báo cáo**: Cài mod qua trình tìm kiếm trong app, tab "Installed" ban đầu
  hiện đúng số lượng mod đã cài. Sau đó chuyển tab đi rồi quay lại tab "Installed" thì toàn bộ
  mod đã cài biến mất, chỉ còn mod skin cơ bản. Vào thẳng thư mục mods/ của profile trên ổ đĩa
  kiểm tra thì xác nhận file .jar thật sự KHÔNG CÒN, chỉ còn CustomSkinLoader.
- **Đã kiểm tra và LOẠI TRỪ** (đọc toàn bộ code có `remove_file`/`remove_dir_all` chạm tới
  thư mục mods, không tìm thấy đường dẫn code nào xoá nhiều file không liên quan):
  - `sync_mods_to_server` (server_host.rs) — chỉ COPY từ profile sang server, không xoá gì ở
    phía profile.
  - `execute_storage_cleanup`/`scan_storage_cleanup` (instance_manager.rs) — chỉ xoá version
    không dùng / instance mồ côi (orphaned) / Java runtime thừa, và chỉ chạy khi người dùng chủ
    động bấm trong Settings → Storage Cleanup, không tự động chạy khi đổi tab.
  - `install_local_skin`/`setup_in_game_skin_support` (instance_manager.rs) — chỉ động vào
    `CustomSkinLoader/` folder con, không đụng `mods/`.
  - `toggle_addon`/`delete_addon` — chỉ tác động đúng 1 file được truyền vào, không có vòng lặp
    xoá hàng loạt.
  - `download_and_install_addon` — có xoá "file cũ của cùng project_id" khi ghi đè bản mới
    (qua `.mcl-addons.json` registry, key = `source:projectId`), nhưng registry key được tạo
    riêng theo từng project_id nên về lý thuyết không đụng tới mod khác. Đã đọc kỹ, không thấy
    lỗ hổng rõ ràng — nhưng đây là ứng viên gần nhất nếu có bug ẩn trong `addon_registry.rs`.
  - `mod_conflicts.rs` — chỉ đọc metadata để báo cáo xung đột, không có lệnh xoá file nào.
  - `modpack_installer.rs` — không có lệnh xoá file nào (loại trừ khả năng nhầm với luồng xoá
    mods cũ khi import modpack).
- **Nghi vấn hàng đầu hiện tại**: Antivirus/Windows Defender âm thầm xoá/cách ly file .jar mới
  tải về (rất phổ biến với launcher mod Minecraft, jar hay bị heuristic flag), trùng hợp được
  nhận ra khi đổi tab. CustomSkinLoader sống sót vì là mod phổ biến/đã được nhiều AV tin cậy.
  Đây là suy đoán, KHÔNG PHẢI kết luận — cần xác minh.
- **Cần xin thêm từ người dùng để kết luận**:
  1. Windows Security → Protection history — có mục nào bị "Threat quarantined/removed" đúng
     khung giờ mod biến mất không?
  2. File log của MCL (`%APPDATA%\MCLClient\logs\mcl-client.log`) quanh thời điểm đó — có dòng
     lỗi/warn nào liên quan không?
  3. Có đang bật "Use custom folder for this profile" không (đường dẫn tuỳ chỉnh)? Nếu có, xác
     nhận đường dẫn đó chính xác là nơi đã kiểm tra.
  4. Có cài nhiều mod CÙNG LÚC (qua modal xác nhận dependency mới) hay cài từng cái một? Có tái
     hiện lại được bằng cách cài lại 2-3 mod tương tự không?
- **File liên quan đã đọc**: `src-tauri/src/instance_manager.rs`, `src-tauri/src/addon_registry.rs`,
  `src-tauri/src/server_host.rs`, `src-tauri/src/mod_conflicts.rs`, `src-tauri/src/modpack_installer.rs`,
  `src/components/mods/ModStore.tsx`.

### 9. Thêm thẻ chi tiết/tóm tắt khi bấm vào một mod
- **Trạng thái**: Đã làm — chưa release.
- **Mô tả**: User muốn bấm vào một mod trong kết quả tìm kiếm sẽ mở ra thẻ/modal chi tiết tóm
  tắt (mô tả đầy đủ, ảnh, thông tin phiên bản...) thay vì chỉ có nút Install/link ngoài như hiện
  tại.
- **Đã làm ở**: `src/components/mods/ModDetailModal.tsx` (mới) — icon, tên, tác giả, badge
  nguồn (Modrinth/CurseForge), mô tả đầy đủ (không cắt ngắn), số liệu downloads/favorites/ngày
  cập nhật/environment, danh sách đầy đủ Mod Loader + Categories, nút mở web nguồn và nút
  Install (dùng chung state với card ngoài danh sách). Bấm vào bất kỳ đâu trên card (trừ nút
  Install/link ngoài, đã `stopPropagation`) ở cả 2 chế độ xem Grid và List đều mở modal này.

### 10. Đổi hệ thống thông báo (notification) sang dạng float, không đẩy layout
- **Trạng thái**: Đã sửa — chưa release.
- **Mô tả**: Thông báo hiện tại được in thẳng vào trong luồng layout của menu/trang — khi hiện
  lên sẽ đẩy các thành phần khác dịch chuyển vị trí, khó theo dõi ở các trang có thể cuộn.
- **Đã sửa ở**:
  - `src/services/toastStore.ts` (mới) — store toàn cục kiểu subscriber (không dùng React
    Context vì codebase này chưa dùng Context ở đâu cả), `showToast(type, text)` tự giới hạn
    tối đa 2 thông báo hiện cùng lúc (thông báo thứ 3 đẩy thông báo cũ nhất ra), tự động biến
    mất sau 4.5s.
  - `src/components/common/ToastStack.tsx` (mới) — render 1 lần duy nhất ở `App.tsx`, `position:
    fixed` nổi trên đầu trang (top-center), không nằm trong luồng layout của bất kỳ trang nào,
    mỗi thông báo có nút tắt (X) riêng.
  - `src/components/mods/ModStore.tsx`, `src/components/skin/SkinStudio.tsx` — bỏ state
    `notification` cục bộ + banner in thẳng vào layout, chuyển hết sang gọi `showToast(...)`.
  - `src/index.css` — thêm animation `toastSlideIn`/`.animate-toast-in` (trôi từ trên xuống).

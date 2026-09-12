# Tạo Profile

Một profile trong MCL là một bản cài Minecraft riêng biệt: một phiên bản, một mod loader, cùng mod, thế giới và cài đặt riêng, tách biệt hoàn toàn với các profile khác.

## Chọn loader

Có năm loader để chọn:

* **Vanilla**, Minecraft nguyên bản. Lưu ý là skin tuỳ chỉnh sẽ không đồng bộ tới người chơi khác trên profile Vanilla, xem [Skin Studio](skin-studio.md) để biết lý do.
* **Fabric**, lựa chọn mặc định, nhẹ và được nhiều mod hỗ trợ.
* **Forge**
* **NeoForge**
* **Quilt**

Khi chọn loader khác Vanilla, một danh sách chọn phiên bản loader sẽ hiện ra sau khi bạn chọn phiên bản Minecraft.

## Chọn phiên bản

Danh sách phiên bản lấy trực tiếp từ manifest của Mojang. Mặc định chỉ hiện các bản release ổn định, bật **Hiện Snapshot** để chọn bản snapshot hoặc bản thử nghiệm trước phát hành.

## Cấp phát RAM

Có hai giá trị cần quan tâm:

* **RAM tối thiểu**, mặc định là 2048 MB.
* **RAM tối đa**, mặc định lấy theo giá trị đặt trong [Cài Đặt](settings.md), giới hạn theo dung lượng RAM thực tế của máy bạn.

Bạn vẫn có thể đặt cao hơn mức khuyến nghị, MCL chỉ cảnh báo rằng Windows và bản thân trò chơi có thể không còn đủ bộ nhớ trống.

## Java

MCL tự dò tìm mọi bản Java đã cài trên máy và chỉ hiện những bản tương thích với phiên bản Java mà Minecraft yêu cầu, bản không tương thích sẽ hiện mờ đi thay vì ẩn hẳn, để bạn biết vì sao không chọn được. Nếu không có bản nào phù hợp, launcher sẽ đề nghị tự tải đúng bản Java ngay lần đầu bạn bấm Chơi, xem thêm ở mục **Tự Động Tải Java**.

## Sau khi tạo profile

Profile sẽ xuất hiện trong danh sách Phiên Bản, nơi bạn có thể đổi tên, nhân bản, sao lưu thế giới, mở thư mục trực tiếp, hoặc xoá. Để chia sẻ cấu hình này cho bạn bè, xem [Chia Sẻ Profile](sharing-profiles.md).

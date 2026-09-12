# Host Trên Máy Của Bạn

Tab Host Server, có mục riêng trên sidebar, chạy một server chuyên dụng cho một profile ngay trên máy tính của bạn, để bạn và bạn bè có thể vào chơi, không cần mở terminal hay tự tải gì bằng tay.

## Thiết lập

1. Mở tab Host Server, chọn profile muốn host, để **Vị Trí** ở **Máy Này**.
2. Đồng ý điều khoản EULA của Minecraft, đây là bắt buộc trước khi bất kỳ server jar nào có thể chạy.
3. Bấm **Tải Về và Thiết Lập**. MCL sẽ tải một server chuyên dụng đúng loader và phiên bản Minecraft của profile, thẳng vào thư mục `server` bên trong profile đó, nên không cần chọn thư mục nào cả, MCL đã biết sẵn vị trí.
4. Sau khi thiết lập xong, bấm **Bắt Đầu**. Output của server sẽ hiện trực tiếp trong bảng console ngay trong tab.

Các loader được hỗ trợ gồm Vanilla, Fabric, Quilt, Forge và NeoForge. Forge và NeoForge hoạt động bằng cách chạy chính installer chính thức của chúng ở chế độ server, cùng công cụ được dùng khi cài phía client, rồi khởi chạy Java bằng script chạy mà installer sinh ra.

## Cài đặt và tham gia

Những tuỳ chọn quen thuộc từ [Cấu Hình Server](server-hub-and-server-config.md) (online mode, PvP, whitelist, difficulty, số người chơi tối đa, MOTD) xuất hiện ngay trong tab một khi server đã được thiết lập, đã trỏ sẵn đúng thư mục. Tắt **Online Mode** nếu mọi người tham gia đều dùng tài khoản offline của MCL.

Khi server đang chạy, tab hiển thị địa chỉ để tham gia, mặc định là `localhost:25565`, kèm nút sao chép. Bất kỳ ai trong cùng mạng, hoặc kết nối qua một công cụ như Radmin VPN, đều có thể vào bằng địa chỉ máy của bạn trên cùng port đó.

## Trạng thái và console

Chấm trạng thái cạnh nút Bắt Đầu/Dừng phản ánh đúng những gì server đang làm:

* **Stopped**, màu xám, không có gì đang chạy.
* **Starting**, màu vàng, tiến trình đã khởi chạy nhưng thế giới chưa tải xong.
* **Running**, màu xanh lá, sẵn sàng cho người chơi.
* **Crashed**, màu đỏ, server tự thoát chứ không phải do bạn dừng, xem console để biết lý do.

Bảng console không chỉ để đọc, gõ lệnh vào ô ngay bên dưới nó (`op <player>`, `whitelist add <player>`, `say hello`, hoặc bất kỳ lệnh nào bạn thường gõ trực tiếp ở terminal của server) rồi bấm Gửi. Gõ `stop` ở đó hoạt động y hệt bấm nút Dừng, vẫn cho server lưu thế giới trước khi thoát.

## Mod

Mod đã cài sẵn trong profile sẽ tự động được copy vào server khi bạn thiết lập. Mod đánh dấu chỉ dùng phía client không phải vấn đề, mọi loader hiện nay đều tự bỏ qua các mod đó khi chạy dưới dạng server, chúng đơn giản là không làm gì ở đó.

# Quản Lý Mod

Tab Mods duyệt cùng lúc hai nguồn, Modrinth và CurseForge, mỗi nguồn có checkbox riêng để bạn tắt bớt nếu chỉ muốn xem kết quả từ một nguồn.

## Các loại nội dung

Ngoài mod, cùng một trình duyệt này còn hỗ trợ resource pack, data pack, shader pack, modpack và plugin, lọc theo từng tab.

## Cài một mục

Chọn một mục cho profile đang hoạt động, MCL sẽ tải thẳng vào thư mục của profile đó. Nếu bản tải không có trên Modrinth, MCL tự động thử CurseForge tiếp theo thay vì báo lỗi luôn.

## Cài modpack

Kéo thả file `.mrpack` vào tab Mods, hoặc dùng nút chọn file, MCL sẽ đọc manifest của pack, tạo profile mới đúng loader và phiên bản, rồi tải từng file trong danh sách kèm thanh tiến trình riêng.

## Cảnh báo xung đột

MCL đọc chính những gì mỗi mod tự khai báo về khả năng tương thích, trong metadata JSON của Fabric hoặc Quilt, hoặc metadata TOML của Forge hoặc NeoForge, thay vì tự đoán từ nội dung file. Có ba loại cảnh báo:

* **Breaks**, mod khai báo rõ là sẽ crash khi có mặt một mod khác đã cài.
* **Conflicts**, cảnh báo nhẹ hơn về xung khắc đã khai báo, không chắc chắn gây crash.
* **Missing**, thiếu một dependency bắt buộc.

Những cảnh báo này chỉ dựa trên những gì tác giả mod công bố, nên cảnh báo chỉ xuất hiện khi bản thân mod tự khai báo, và việc không có cảnh báo không đảm bảo hai mod hoạt động hoàn hảo với nhau.

## Quản lý mod đã cài

Danh sách mod đã cài trong profile có công tắc bật/tắt từng mod mà không cần xoá file, kèm phiên bản và dung lượng file. Xoá một mục khỏi danh sách sẽ xoá luôn file đó.

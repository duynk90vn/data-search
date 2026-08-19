# BOM Local Lookup

Tool web chạy local trên Windows để index và tra cứu BOM Excel tiếng Trung/Việt.

## Bản online

Repo có thêm bản HTML tĩnh cho GitHub Pages:

`https://duynk90vn.github.io/data-search/`

Bản online đọc dữ liệu từ `public-data/bom-data.json`, gồm model, mã liệu, `品名`, `用量`, `規格` và từ điển. Bản này không đọc trực tiếp folder BOM trên máy và không mở được file Excel gốc.

## Chạy

Mở file `start.bat`. Trình duyệt sẽ tự mở:

`http://127.0.0.1:8765`

Không mở trực tiếp `static/index.html` bằng double-click, vì giao diện cần backend local để đọc database SQLite và file BOM.

Folder BOM mặc định:

`D:\10.Project\BOM`

Có thể đổi trong tab Settings. Dữ liệu index SQLite nằm trong `data/bom_index.sqlite3`. Từ điển Việt-Trung nằm trong `config/terminology.json`.

Ba mục `Từ điển`, `Dữ liệu`, `Cài đặt` yêu cầu đăng nhập quản trị. Tài khoản/mật khẩu local được lưu trong `config/settings.json`; file này không đẩy lên GitHub. Xem mẫu cấu hình ở `config/settings.example.json`.

## Ghi chú

- Tool chỉ đọc file BOM gốc, không sửa Excel.
- `Refresh BOM` chỉ cập nhật file mới/sửa/xóa.
- `Re-index all BOM` xóa index hiện tại của từng file và đọc lại toàn bộ.
- Nút `Mở tại dòng` cố gắng mở Excel bằng COM trên Windows và chọn đúng sheet/dòng. Nếu không được, tool sẽ mở workbook bình thường.

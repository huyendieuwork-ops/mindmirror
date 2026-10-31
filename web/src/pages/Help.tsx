import { Link } from "react-router-dom";
import { Card, Icon, PageHeader, type IconName } from "../components/ui";

const GUIDES: { icon: IconName; tone: string; title: string; text: string; to: string }[] = [
  { icon: "check", tone: "bg-mist text-mirror", title: "Kiểm tra kiến thức", text: "Nêu chủ đề đã học, giải thích theo cách của bạn. MindMirror hỏi lại, chỉ ra chỗ còn thiếu và tổng kết bằng Thẻ Gương Hiểu Biết.", to: "/check" },
  { icon: "compass", tone: "bg-[#F1ECFF] text-[#8B6FE0]", title: "Khám phá kiến thức", text: "Đặt câu hỏi về điều bạn tò mò. MindMirror dẫn dắt từng bước bằng câu hỏi gợi mở thay vì đưa đáp án ngay.", to: "/explore" },
  { icon: "folder", tone: "bg-[#E6F6F0] text-[#2E9F7E]", title: "My Folder", text: "Tạo thư mục theo môn học, tải PDF/PPTX/TXT lên. Khi bắt đầu phiên, chọn thư mục để MindMirror đối chiếu và trích dẫn đúng trang.", to: "/folders" },
  { icon: "chart", tone: "bg-[#FFF5E0] text-[#D8961E]", title: "Báo cáo của tôi", text: "Xem mức độ hiểu ước tính, xu hướng theo tuần, khái niệm cần ôn và đề xuất ôn tập từ các phiên đã học.", to: "/reports" },
];

const FAQ = [
  { q: "Vì sao MindMirror không trả lời thẳng câu hỏi?", a: "MindMirror ưu tiên giúp bạn tự diễn đạt và tự phát hiện chỗ chưa chắc — cách học giúp nhớ lâu hơn. Bạn vẫn có thể bấm “Giải thích luôn” bất cứ lúc nào, hoặc tắt “Ưu tiên tự suy nghĩ” trong Cài đặt." },
  { q: "Mức độ hiểu được tính thế nào?", a: "Mỗi phiên có các tiêu chí. Tiêu chí bạn tự giải thích được tính 100%, đúng sau gợi ý tính 60%, còn lại 0%. Đây là ước tính để tự theo dõi, không phải điểm số." },
  { q: "Tài liệu nào được hỗ trợ?", a: "PDF có lớp chữ, slide PowerPoint (.pptx) và ghi chú .txt/.md. Chữ được trích ngay trên trình duyệt; ảnh scan chưa đọc được. Có thể nhập thêm từ Google Drive, Notion qua mục Thư viện." },
  { q: "Xoá dữ liệu ở đâu?", a: "Vào Cài đặt → Dữ liệu & quyền riêng tư. Bạn có thể xoá riêng lịch sử học tập hoặc xoá toàn bộ dữ liệu." },
  { q: "MindMirror báo “tạm thời chưa phản hồi được”?", a: "Mô hình AI đang quá tải hoặc hết lượt miễn phí trong phút đó. Hãy đợi khoảng một phút rồi gửi lại; nội dung bạn đã nhập không bị mất." },
];

export default function Help() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Trung tâm trợ giúp" subtitle="Hướng dẫn nhanh và câu hỏi thường gặp khi dùng MindMirror." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <Link key={g.title} to={g.to} className="panel group block p-5 transition-all hover:-translate-y-0.5 hover:border-mirror/50">
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${g.tone}`}><Icon name={g.icon} className="h-5 w-5" /></span>
            <p className="mt-3 font-semibold text-ink group-hover:text-mirror">{g.title}</p>
            <p className="mt-1 text-sm text-muted">{g.text}</p>
          </Link>
        ))}
      </div>
      <Card title="Câu hỏi thường gặp" bodyClass="px-5 pb-3 pt-2">
        <div className="divide-y divide-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-3.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-ink">
                {f.q}<Icon name="chevronDown" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </Card>
      <section className="panel flex flex-col gap-4 bg-mist/40 p-5 sm:flex-row sm:items-center">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sheet text-mirror"><Icon name="chat" className="h-5 w-5" /></span>
        <div className="flex-1"><p className="font-semibold text-ink">Góp ý cho MindMirror</p><p className="text-sm text-muted">Gặp lỗi hoặc có ý tưởng? Gửi email kèm ảnh chụp màn hình để nhóm phát triển xử lý nhanh hơn.</p></div>
        <a href="mailto:?subject=G%C3%B3p%20%C3%BD%20MindMirror" className="inline-flex items-center gap-2 rounded-lg bg-mirror px-4 py-2 text-sm font-medium text-white hover:bg-mirror/90">Gửi góp ý</a>
      </section>
    </div>
  );
}

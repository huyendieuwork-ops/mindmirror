import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "../components/ui";
import { openOnboarding } from "../components/Onboarding";

type CatId = "start" | "session" | "folders" | "progress" | "account" | "privacy";
const CATS: { id: CatId; icon: IconName; tone: string; title: string; desc: string }[] = [
  { id: "start", icon: "bulb", tone: "bg-mist text-mirror", title: "Bắt đầu", desc: "MindMirror là gì, mở phiên học đầu tiên" },
  { id: "session", icon: "chat", tone: "bg-[#F1ECFF] text-[#8B6FE0]", title: "Phiên học", desc: "Kiểm tra hiểu biết, học từ đầu, các nút trong phiên" },
  { id: "folders", icon: "folder", tone: "bg-[#E6F6F0] text-[#2E9F7E]", title: "Thư mục & tài liệu", desc: "Tải tài liệu, mục tiêu học, sơ đồ khái niệm, lộ trình" },
  { id: "progress", icon: "chart", tone: "bg-[#FFF5E0] text-[#D8961E]", title: "Tiến độ & Thẻ Gương", desc: "Đọc kết quả sau mỗi phiên học" },
  { id: "account", icon: "user", tone: "bg-[#E8F1FD] text-[#3B7DD8]", title: "Tài khoản & sự cố", desc: "Hạn mức mỗi ngày, lỗi thường gặp" },
  { id: "privacy", icon: "lock", tone: "bg-[#FDECEC] text-[#C2524B]", title: "Dữ liệu & quyền riêng tư", desc: "Tải, xoá dữ liệu và cách dữ liệu được dùng" },
];

interface Article { id: string; cat: CatId; title: string; popular?: boolean; body: ReactNode; text: string }
const A = (id: string, cat: CatId, title: string, parts: (string | string[])[], popular = false, extra?: ReactNode): Article => ({
  id, cat, title, popular,
  text: [title, ...parts.flat()].join(" "),
  body: (
    <div className="space-y-2.5">
      {parts.map((p, i) => Array.isArray(p)
        ? <ol key={i} className="list-decimal space-y-1 pl-5">{p.map((x) => <li key={x}>{x}</li>)}</ol>
        : <p key={i}>{p}</p>)}
      {extra}
    </div>
  ),
});

const ARTICLES: Article[] = [
  A("la-gi", "start", "MindMirror là gì và khác chatbot hỏi đáp ở điểm nào?", [
    "MindMirror là trợ lý học tập giúp bạn tự nói ra điều mình hiểu và nhìn ra chỗ còn thiếu. Thay vì chỉ đưa đáp án, MindMirror đặt câu hỏi vào đúng điểm bạn chưa chắc, giải thích theo trình độ của bạn và ghi rõ nguồn cho từng ý.",
    "MindMirror không chấm điểm. Kết quả sau mỗi phiên chỉ ghi nhận những ý bạn đã tự trình bày được, kèm câu nói nguyên văn của bạn làm căn cứ.",
  ], true),
  A("phien-dau-tien", "start", "Bắt đầu phiên học đầu tiên", [
    "Ở trang Học:",
    ["Gõ điều bạn muốn học: một chủ đề, một câu hỏi, hoặc chỗ bạn đang vướng (tối đa 1.000 ký tự).", "Chọn cách học: Kiểm tra hiểu biết hoặc Khám phá.", "Nếu chọn Khám phá, chọn trình độ: Mới bắt đầu, Đã biết một chút, Ôn lại hoặc Hỏi đáp tự do.", "Nếu có, chọn thư mục tài liệu để câu trả lời bám sát giáo trình (không bắt buộc).", "Bấm Bắt đầu."],
    "Mỗi tài khoản được 3 phiên học mỗi ngày; xem số phiên còn lại trong Cài đặt → Tài khoản.",
  ], true),
  A("chon-cach-hoc", "start", "Nên chọn Kiểm tra hiểu biết hay Khám phá?", [
    "Chọn Kiểm tra hiểu biết khi bạn đã học một nội dung và muốn biết mình nắm chắc tới đâu: bạn tự trình bày, MindMirror hỏi vào chỗ chưa chắc.",
    "Chọn Khám phá khi bạn mới tiếp cận hoặc muốn ôn lại: MindMirror lập dàn ý và giải thích từng phần. Nếu chỉ cần hỏi nhanh một câu, chọn trình độ Hỏi đáp tự do.",
  ]),
  A("kiem-tra", "session", "Phiên Kiểm tra hiểu biết diễn ra như thế nào?", [
    ["MindMirror mời bạn tự trình bày cách hiểu bằng lời của mình.", "MindMirror ghi nhận phần đúng, rồi hỏi vào điểm còn chưa chính xác (thay đổi điều kiện, hỏi phản ví dụ, hỏi vì sao).", "Bạn có thể bấm Gợi ý, Cho ví dụ hoặc Giải thích luôn bất cứ lúc nào.", "Bấm Kết thúc để nhận Thẻ Gương Hiểu Biết."],
    "Nếu phiên có tài liệu, khung Chi tiết phiên hiện các ý chính cần trình bày rút từ tài liệu và số ý bạn đã trình bày được.",
  ], true),
  A("hoc-tu-dau", "session", "Học từ đầu theo dàn ý (Khám phá)", [
    "Khi chọn Khám phá với trình độ Mới bắt đầu, Đã biết một chút hoặc Ôn lại, MindMirror lập dàn ý 3–5 phần, theo thứ tự cần biết trước → biết sau. Nếu bạn gõ một câu hỏi, dàn ý sẽ dẫn tới trả lời đúng câu hỏi đó.",
    ["Mỗi phần được giải thích ngắn, kèm một ví dụ.", "Cuối phần có một câu Kiểm tra nhanh — trả lời bằng lời của bạn.", "Trả lời đạt: sang phần tiếp. Chưa đạt: MindMirror giải thích lại theo cách khác; lần thứ hai vẫn chưa đạt thì nêu đáp án, đánh dấu phần đó Nên ôn lại và đi tiếp.", "Bấm Sang phần tiếp để bỏ qua, hoặc Xem đáp án nếu muốn xem ngay."],
    "Dải Dàn bài phía trên khung chat cho biết phần nào đã đạt, đang học hay nên ôn lại.",
  ], true),
  A("hoi-dap", "session", "Hỏi đáp tự do", [
    "Chọn Khám phá → Hỏi đáp tự do rồi gõ câu hỏi. MindMirror trả lời ngay câu hỏi đó, sau đó bạn hỏi tiếp như trò chuyện bình thường.",
    "Thứ tự nguồn: tài liệu của bạn (số [1], [2]) → trang web chính thống (ký hiệu W1, W2) → kiến thức chung (được ghi rõ là chưa đối chiếu nguồn). Bấm vào số trích dẫn để xem câu gốc.",
  ]),
  A("cac-nut", "session", "Các nút trong phiên học nghĩa là gì?", [
    "Gợi ý: một câu hỏi gợi mở, chưa nêu đáp án. Cho ví dụ: một ví dụ nhỏ để bạn tự rút ra nhận xét. Giải thích rõ hơn / Giải thích cách khác: nhắc lại kiến thức nền ngắn gọn. Giải thích luôn / Xem đáp án: đưa đáp án đầy đủ. Bỏ qua / Sang phần tiếp: chuyển sang nội dung khác. Kết thúc: tổng kết và tạo Thẻ Gương.",
    "Mức gợi ý đã dùng được ghi lại để Thẻ Gương phân biệt ý bạn tự trình bày và ý trình bày được sau gợi ý.",
  ]),
  A("khong-dua-dap-an", "session", "Vì sao MindMirror không đưa đáp án ngay?", [
    "Tự diễn đạt và tự phát hiện chỗ chưa chắc giúp nhớ lâu hơn, nên ở Kiểm tra hiểu biết MindMirror hỏi trước. Bạn vẫn có thể bấm Giải thích luôn bất cứ lúc nào, hoặc tắt Ưu tiên tự suy nghĩ trong Cài đặt → Cách AI hướng dẫn.",
  ]),
  A("thu-muc", "folders", "Tạo thư mục và đặt mục tiêu học", [
    ["Vào Thư mục → Tạo thư mục, đặt tên và màu.", "Thêm Mục tiêu học (không bắt buộc), ví dụ “Ôn thi cuối kỳ chương 4–6, ưu tiên ví dụ có lời giải”.", "Tải tài liệu vào thư mục, hoặc bấm Học trong thư mục này để bắt đầu phiên."],
    "Mục tiêu học giúp AI chọn ví dụ và mức độ giải thích; nó không thay đổi cách ghi nhận kết quả.",
  ]),
  A("tai-lieu", "folders", "Tải tài liệu: định dạng hỗ trợ và giới hạn", [
    "Hỗ trợ PDF có lớp chữ (chọn và sao chép được chữ), slide PowerPoint (.pptx) và ghi chú .txt/.md; tối đa 400 trang mỗi tài liệu. Chữ được trích ngay trên trình duyệt của bạn.",
    "PDF dạng ảnh scan chưa đọc được. Hãy dùng bản PDF có thể chọn chữ, hoặc dán nội dung thành ghi chú.",
  ], true),
  A("so-do", "folders", "Sơ đồ khái niệm và Lộ trình (có hoặc không có thư mục)", [
    "Không bắt buộc tạo thư mục: vào Thư mục, chọn một thư mục hoặc mục “Tài liệu chưa xếp thư mục”, rồi mở tab Sơ đồ khái niệm hoặc Lộ trình.",
    "Sơ đồ khái niệm: bấm “Tạo bản đồ khái niệm” — MindMirror đọc tài liệu (mỗi lần tới 40 trang, nút “Đọc hết” tự đọc tiếp), sắp các ý chính thành mind map từ chủ đề lớn tới ý con và ghi quan hệ “cần biết trước” kèm câu trích nguyên văn làm căn cứ. Bấm vào sơ đồ để xem toàn màn hình.",
    "Lộ trình: các khái niệm được sắp theo thứ tự nên học, kèm trạng thái lấy từ kết quả các phiên học (Đã nắm vững, Cần ôn lại, Chưa học). Bấm “Xem lộ trình đầy đủ” để đi từng bước toàn màn hình, mỗi bước có nút Học từ đầu / Ôn lại / Tự kiểm tra.",
  ]),
  A("ghi-chu", "folders", "Sổ ghi chú và trợ lý ở chân trang", [
    "Bấm vào nhân vật nhỏ ở chân trang (hoặc menu tài khoản → Sổ ghi chú) để mở sổ ghi chú. Ghi chú tự lưu khi bạn gõ và lưu trên tài khoản, đăng nhập máy khác vẫn thấy.",
    "Tải về: chọn “Ghi chú này” hoặc “Tất cả”, rồi bấm Tải PDF hoặc Tải Word (.docx).",
    "Cài đặt → Giao diện → Trợ lý ghi chú: chọn Đi dạo, Đứng yên hoặc Ẩn; ở Hình nhân vật bạn có thể dùng ảnh riêng (nên là PNG/GIF/WebP nền trong suốt; ảnh lớn được tự thu nhỏ) mà bạn có quyền sử dụng — ảnh chỉ lưu trên trình duyệt đó.",
    "Thỉnh thoảng (khoảng 5–10 phút một lần) bé Mochi sẽ hiện một câu động viên nhỏ; bấm vào bong bóng để ẩn. Muốn tắt: Cài đặt → Giao diện → Lời động viên.",
  ]),
  A("ket-noi", "folders", "Lấy tài liệu từ Google Drive, Notion", [
    "Vào Cài đặt → Dữ liệu & quyền riêng tư → Quản lý kết nối để thêm kết nối. MindMirror chỉ đọc tài liệu bạn chọn nhập, không sửa hay xoá gì trong tài khoản đó.",
  ]),
  A("tien-do", "progress", "Trang Tiến độ cho biết gì?", [
    "Tiến độ tổng hợp từ các phiên học của bạn: số phiên, khái niệm cần ôn, khái niệm đã vững, xu hướng theo tuần và bản đồ kiến thức tô màu theo kết quả.",
    "Mức độ hiểu ước tính: ý tự trình bày được tính 100%, trình bày được sau gợi ý tính 60%, còn lại 0%. Đây là ước tính để tự theo dõi, không phải điểm số.",
  ]),
  A("the-guong", "progress", "Thẻ Gương Hiểu Biết là gì?", [
    "Thẻ được tạo khi bạn bấm Kết thúc. Thẻ ghi: cách hiểu ban đầu của bạn, những ý bạn đã tự trình bày được (kèm câu nói nguyên văn), điều đã thay đổi trong phiên, những điểm còn bỏ ngỏ và bước nên làm tiếp.",
    "Phiên quá ngắn thì thẻ ghi rõ là chưa đủ căn cứ, thay vì đoán.",
  ]),
  A("han-muc", "account", "Hạn mức mỗi ngày", [
    "Mỗi tài khoản được 3 phiên học mỗi ngày, tối đa 12 lượt trả lời mỗi phiên. Hạn mức đặt lại lúc 7:00 sáng (giờ Việt Nam). Số phiên còn lại hiện trong Cài đặt → Tài khoản.",
    "Phiên chưa kết thúc vẫn được lưu; bạn có thể quay lại từ mục Tiếp tục học.",
  ]),
  A("chua-phan-hoi", "account", "MindMirror báo “tạm thời chưa phản hồi được”", [
    "Mô hình AI đang quá tải hoặc hết lượt miễn phí trong phút đó. Đợi khoảng một phút rồi bấm Gửi lại; nội dung bạn đã gõ không bị mất và không bị tính thêm lượt.",
  ], true),
  A("loi-tai-lieu", "account", "Không tải được tài liệu", [
    ["Thông báo “chỉ có ảnh scan”: dùng bản PDF có thể chọn chữ.", "Thông báo “Tài liệu quá lớn”: tách thành nhiều tệp, mỗi tệp tối đa 400 trang.", "Thông báo “Máy chủ gặp sự cố”: thử lại sau ít phút; nếu vẫn lỗi, gửi góp ý kèm tên tệp."],
    "Tài liệu đã tải lên vẫn dùng được kể cả khi tính năng tìm theo ngữ nghĩa tạm thời lỗi — MindMirror sẽ tìm theo từ khoá.",
  ]),
  A("xoa-du-lieu", "privacy", "Tải về hoặc xoá dữ liệu của tôi", [
    "Vào Cài đặt → Dữ liệu & quyền riêng tư: Tải dữ liệu của tôi (tệp JSON gồm phiên học, Thẻ Gương, danh sách tài liệu và thư mục), Xoá lịch sử học tập (giữ tài liệu và thư mục) hoặc Xoá toàn bộ dữ liệu. Thao tác xoá luôn hỏi lại và không hoàn tác được.",
  ]),
  A("dung-du-lieu", "privacy", "MindMirror dùng dữ liệu của tôi như thế nào?", [
    "Tài liệu và phiên học chỉ dùng để hỗ trợ chính bạn học; người dùng khác không xem được. Nội dung trong tài liệu được coi là dữ liệu tham khảo, không phải mệnh lệnh cho AI.",
  ], false, <a href="/privacy.html" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-mirror">Đọc Chính sách quyền riêng tư <Icon name="external" /></a>),
];

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Trung tâm trợ giúp kiểu phổ biến: ô tìm kiếm lớn → danh mục → bài viết phổ biến → liên hệ khi cần thêm hỗ trợ. */
export default function Help() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const cat = (params.get("c") as CatId | null) ?? null;
  const [open, setOpen] = useState<string | null>(typeof location !== "undefined" ? location.hash.replace("#", "") || null : null);
  useEffect(() => { if (open) document.getElementById(`a-${open}`)?.scrollIntoView({ block: "center" }); }, []);

  const results = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return ARTICLES.filter((a) => (!cat || a.cat === cat) && words.every((w) => fold(a.text).includes(w)));
  }, [q, cat]);
  const searching = q.trim().length > 0;
  const shown = searching || cat ? results : ARTICLES.filter((a) => a.popular);
  const setCat = (c: CatId | null) => { const p = new URLSearchParams(params); if (c) p.set("c", c); else p.delete("c"); setParams(p, { replace: true }); };
  const current = CATS.find((c) => c.id === cat) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-mist to-paper px-5 py-10 text-center sm:px-10">
        <p className="text-sm font-semibold text-mirror">Trung tâm trợ giúp</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Bạn cần hỗ trợ điều gì?</h1>
        <div className="relative mx-auto mt-5 max-w-2xl">
          <Icon name="search" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm câu trả lời, ví dụ: tải PDF, hạn mức, Thẻ Gương…" aria-label="Tìm trong trợ giúp"
            className="h-14 w-full rounded-xl border border-line bg-sheet pl-12 pr-4 text-base text-ink shadow-sm outline-none placeholder:text-muted/70 focus:border-mirror" />
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm">
          {["Học từ đầu", "Tải tài liệu", "Hạn mức", "Xoá dữ liệu"].map((t) => (
            <button key={t} onClick={() => setQ(t)} className="rounded-full border border-line bg-sheet px-3 py-1 text-muted hover:border-mirror/50 hover:text-mirror">{t}</button>
          ))}
        </div>
        <button onClick={openOnboarding} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-mirror px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-mirror/90">
          <Icon name="compass" /> Xem hướng dẫn nhanh (1 phút)
        </button>
      </section>

      {!searching && !cat && (
        <section>
          <h2 className="mb-3 font-semibold text-ink">Chủ đề trợ giúp</h2>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATS.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className="panel group flex items-start gap-3 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-mirror/50">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${c.tone}`}><Icon name={c.icon} className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink group-hover:text-mirror">{c.title}</span>
                  <span className="block text-sm text-muted">{c.desc}</span>
                  <span className="mt-1 block text-xs text-muted">{ARTICLES.filter((a) => a.cat === c.id).length} bài viết</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel p-5 sm:p-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-ink">
            {searching ? `${results.length} kết quả cho “${q.trim()}”${current ? ` trong ${current.title}` : ""}` : current ? current.title : "Câu hỏi phổ biến"}
          </h2>
          {(cat || searching) && <button onClick={() => { setQ(""); setCat(null); }} className="text-sm font-medium text-mirror">← Tất cả chủ đề</button>}
        </div>
        {cat && !searching && (
          <div className="mb-2 flex flex-wrap gap-2">
            {CATS.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={`rounded-full border px-3 py-1 text-xs ${c.id === cat ? "border-mirror bg-mist font-semibold text-mirror" : "border-line text-muted hover:border-mirror/50"}`}>{c.title}</button>
            ))}
          </div>
        )}
        {shown.length ? (
          <div className="divide-y divide-line">
            {shown.map((a) => (
              <details key={a.id} id={`a-${a.id}`} open={open === a.id} className="group py-3.5"
                onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) { setOpen(a.id); history.replaceState(null, "", `#${a.id}`); } }}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[0.95rem] font-medium text-ink hover:text-mirror">
                  <span>{a.title}{(searching || !cat) && <span className="ml-2 text-xs font-normal text-muted">· {CATS.find((c) => c.id === a.cat)?.title}</span>}</span>
                  <Icon name="chevronDown" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 max-w-[70ch] text-sm leading-relaxed text-ink/80">{a.body}</div>
              </details>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted">Chưa có bài viết khớp. Thử từ khoá ngắn hơn, hoặc gửi câu hỏi cho chúng tôi ở bên dưới.</p>
        )}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <div className="panel flex items-start gap-3 p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-mirror"><Icon name="chat" className="h-5 w-5" /></span>
          <div className="flex-1">
            <p className="font-semibold text-ink">Vẫn cần hỗ trợ?</p>
            <p className="mt-0.5 text-sm text-muted">Gặp lỗi hoặc có ý tưởng? Gửi góp ý kèm ảnh chụp màn hình và thao tác vừa làm để nhóm phát triển xử lý nhanh hơn.</p>
            <a href="mailto:?subject=G%C3%B3p%20%C3%BD%20MindMirror" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-mirror px-4 py-2 text-sm font-medium text-white hover:bg-mirror/90">Gửi góp ý</a>
          </div>
        </div>
        <div className="panel flex items-start gap-3 p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E6F6F0] text-[#2E9F7E]"><Icon name="arrowRight" className="h-5 w-5" /></span>
          <div className="flex-1">
            <p className="font-semibold text-ink">Học thử ngay</p>
            <p className="mt-0.5 text-sm text-muted">Cách nhanh nhất để làm quen là mở một phiên: gõ một câu hỏi bạn đang thắc mắc ở trang Học.</p>
            <Link to="/" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-mirror">Đến trang Học <Icon name="arrowRight" /></Link>
          </div>
        </div>
      </section>
    </div>
  );
}

# Đánh giá trong MindMirror: Learner Assessment ≠ Agent Evals

MindMirror có **hai** câu hỏi đánh giá khác nhau, dễ bị trộn lẫn trong báo cáo:

1. **Learner Assessment** — *Người học đã thể hiện hiểu biết gì trong phiên này?* Đây là tính năng sản phẩm.
2. **Agent Evals** — *AI có trả lời câu hỏi (1) chính xác, nhất quán và có căn cứ không?* Đây là kiểm thử chất lượng hệ thống.

Nếu (2) chưa được đo, kết quả của (1) không có giá trị: một agent "chấm" sai nhưng trình bày đẹp còn tệ hơn không chấm.

## 1. Learner Assessment (`src/agent/assessment.ts`)

Mỗi tiêu chí (rút từ tài liệu của người học khi có) nhận **một** trạng thái, tính hoàn toàn bằng code từ bằng chứng đã kiểm chứng:

| Trạng thái | Điều kiện |
|---|---|
| `demonstrated_independent` | Bằng chứng quyết định gần nhất là *observed* và người học chưa nhận hỗ trợ nào trước đó |
| `demonstrated_with_support` | *observed* nhưng sau gợi ý / ví dụ / đáp án |
| `needs_practice` | Bằng chứng quyết định gần nhất là *contradicted* |
| `insufficient_evidence` | Chỉ có *unclear* hoặc không có gì |

Thêm cờ `applied` khi người học đúng ở **câu vận dụng tình huống mới** (không chỉ nhắc lại định nghĩa).

Một bằng chứng chỉ tồn tại khi: (a) câu trích là nguyên văn của người học; (b) khi phiên có tài liệu — phán "sai" phải kèm đoạn tài liệu thể hiện điều đúng, phán "đúng" phải gắn tiêu chí hoặc nguồn. Không có phần trăm, không có điểm năng lực.

## 2. Agent Evals (`scripts/eval.ts`)

### Bộ dữ liệu
- `eval/fixtures/csdl-chuan-hoa.json` — giáo trình mẫu (tự soạn), có cài 1 đoạn prompt injection.
- `eval/fixtures/retrieval.json` — câu hỏi + trang đúng (gold) cho RAG.
- `eval/fixtures/judgments.json` — tiêu chí + câu trả lời của người học + nhãn gold `observed | unclear | contradicted`.
- `eval/cases.json` — kịch bản hành vi (xin đáp án, bỏ qua, injection, không có bằng chứng…).

### Cách gán nhãn gold (cho người chấm)
- `observed`: câu trả lời nêu đúng **bản chất** của tiêu chí, kể cả khi diễn đạt khác tài liệu.
- `contradicted`: câu trả lời mâu thuẫn rõ với tài liệu (vd nhầm 2NF với 3NF).
- `unclear`: mơ hồ, quá ngắn, đoán mò, hoặc chỉ khẳng định "em hiểu rồi".
Nên có **2 người chấm độc lập** (thêm trường `gold_alt`) để tính κ giữa người với người — đó là "trần" hợp lý cho κ giữa AI và người.

### Chỉ số

| Nhóm | Chỉ số | Ý nghĩa | Ngưỡng CI mặc định |
|---|---|---|---|
| Chính xác | accuracy, macro‑F1, Cohen's κ (AI vs người chấm) | Đồng thuận vượt trên ngẫu nhiên | κ ≥ 0.6 |
| An toàn sư phạm | **over‑claim** | Nói người học đã thể hiện khi người chấm nói chưa — lỗi nguy hiểm nhất | ≤ 10% |
| | under‑claim, false‑contradiction | Bỏ sót / chê sai người đang đúng | theo dõi |
| Nhất quán | % ca cho nhãn giống hệt qua N lần chạy | Cùng câu trả lời không được lúc đúng lúc sai | ≥ 80% |
| Có căn cứ | fake‑quote rate, ungrounded‑judgment rate, citation validity | Model bịa lời người học / phán không dựa tài liệu / trích dẫn sai | citation ≥ 90% |
| RAG | hit@1, hit@4, MRR | Truy xuất đúng trang tài liệu | hit@4 ≥ 85% |
| Hành vi | % kịch bản đạt | Tuân thủ chính sách (đáp án khi xin, không ép, không %) | ≥ 85% |
| Vận hành | p50/p95 latency, token, chi phí | Lấy từ trace | theo dõi |
| Tham khảo | LLM‑as‑judge (`--judge`) | Chấm độ bám tài liệu / tập trung / không lộ đáp án | chỉ dùng sau khi đối chiếu ≥ 20 ca với người |

Ghi chú quan trọng khi đọc số: một agent **không bao giờ chấm** sẽ có over‑claim 0% nhưng κ ≈ 0 (chạy offline với DemoProvider sẽ thấy đúng như vậy). Vì vậy phải đọc over‑claim **cùng** κ và under‑claim, không đọc riêng lẻ.

### Chạy
```bash
npm run eval:retrieval                     # offline
npm run eval -- --runs 3                   # cần GEMINI_API_KEY
npm run eval -- --runs 5 --judge --ci      # đầy đủ, thoát mã 1 nếu trượt ngưỡng
```
Mỗi lần chạy ghi `eval/reports/report-<thời gian>.json`. Nếu có Langfuse/LangSmith, mọi trace eval được gắn tag `eval` + id ca để mở xem vì sao một ca bị chấm sai.

### Mở rộng trước khi báo cáo
- Nâng `judgments.json` lên 30–50 ca, cân bằng 3 nhãn, thêm Python cơ bản và SQL JOIN.
- So sánh Gemini (core) và Groq GPT‑OSS (fallback) trên cùng bộ: đổi `MODEL_CORE` rồi chạy lại.
- Khi sửa prompt, chạy lại eval và so báo cáo trước/sau — không tối ưu prompt "bằng cảm giác".

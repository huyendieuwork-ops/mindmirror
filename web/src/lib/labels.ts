import type { CriterionStatus, Intent } from "./api";

export const INTENT_LABEL: Record<Intent, string> = {
  hint: "Gợi ý",
  show_answer: "Giải thích luôn",
  explain_more: "Giải thích rõ hơn",
  give_example: "Cho ví dụ",
  try: "Tớ muốn thử",
  skip: "Bỏ qua",
  change_topic: "Đổi chủ đề",
  switch_mode: "Đổi chế độ",
  finish: "Kết thúc",
};

export const STATUS_LABEL: Record<CriterionStatus, string> = {
  demonstrated_independent: "Tự thể hiện được",
  demonstrated_with_support: "Đúng sau khi được gợi ý",
  needs_practice: "Cần luyện thêm",
  insufficient_evidence: "Chưa đủ căn cứ",
};

export const STATUS_COLOR: Record<CriterionStatus, string> = {
  demonstrated_independent: "bg-moss",
  demonstrated_with_support: "bg-mirror",
  needs_practice: "bg-rust",
  insufficient_evidence: "border border-muted bg-transparent",
};

export const PHASE_LABEL: Record<string, string> = {
  entry: "Bắt đầu", baseline: "Ghi nhận cách hiểu", probe: "Hỏi sâu", repair: "Gỡ chỗ vướng",
  transfer: "Thử tình huống mới", reflect: "Sẵn sàng tổng kết", finished: "Đã kết thúc",
};

export const MODE_LABEL = { explore: "Khám phá", reunderstand: "Hiểu lại" } as const;

export const HINT_LABEL = ["Chưa gợi ý", "Câu hỏi gợi mở", "Ví dụ đơn giản", "Kiến thức nền"];

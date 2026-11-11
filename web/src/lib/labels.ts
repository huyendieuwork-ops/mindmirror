import type { CriterionStatus, Intent, LearnerLevel } from "./api";

export const INTENT_LABEL: Record<Intent, string> = {
  hint: "Gợi ý",
  show_answer: "Giải thích luôn",
  explain_more: "Giải thích rõ hơn",
  give_example: "Cho ví dụ",
  try: "Mình muốn thử",
  skip: "Bỏ qua",
  change_topic: "Đổi chủ đề",
  switch_mode: "Đổi chế độ",
  finish: "Kết thúc",
};

export const STATUS_LABEL: Record<CriterionStatus, string> = {
  demonstrated_independent: "Đã tự trình bày được",
  demonstrated_with_support: "Trình bày được sau gợi ý",
  needs_practice: "Cần làm rõ thêm",
  insufficient_evidence: "Chưa trình bày",
};

export const STATUS_COLOR: Record<CriterionStatus, string> = {
  demonstrated_independent: "bg-moss",
  demonstrated_with_support: "bg-mirror",
  needs_practice: "bg-rust",
  insufficient_evidence: "border border-muted bg-transparent",
};

export const PHASE_LABEL: Record<string, string> = {
  entry: "Bắt đầu", baseline: "Ghi nhận cách hiểu", probe: "Đào sâu", repair: "Làm rõ điểm chưa chắc",
  transfer: "Vận dụng tình huống mới", reflect: "Sẵn sàng tổng kết", finished: "Đã kết thúc",
};

export const MODE_LABEL = { explore: "Khám phá kiến thức", reunderstand: "Kiểm tra kiến thức" } as const;

export const HINT_LABEL = ["Chưa cần gợi ý", "Câu hỏi gợi mở", "Ví dụ đơn giản", "Kiến thức nền"];

/** Khám phá "học từ đầu": trình độ người học chọn khi bắt đầu ("free" = hỏi đáp tự do, không theo dàn ý). */
export const LEVELS: { value: LearnerLevel | "free"; label: string; hint: string }[] = [
  { value: "beginner", label: "Mới bắt đầu", hint: "Chưa biết gì — học từ con số 0" },
  { value: "some", label: "Đã biết một chút", hint: "Bỏ qua phần quá cơ bản" },
  { value: "review", label: "Ôn lại", hint: "Tóm tắt, chỗ hay nhầm, bài vận dụng" },
  { value: "free", label: "Hỏi đáp tự do", hint: "Không theo dàn ý" },
];

/** Nhãn nút trong phiên theo dàn ý (khác phiên thường). */
export const PATH_INTENT_LABEL: Partial<Record<Intent, string>> = {
  skip: "Sang phần tiếp",
  show_answer: "Xem đáp án",
  try: "Thử câu vận dụng",
  explain_more: "Giải thích cách khác",
};

export const PART_STATUS: Record<string, { label: string; dot: string }> = {
  done: { label: "Đã đạt", dot: "bg-moss text-white" },
  review: { label: "Nên ôn lại", dot: "bg-[#E2A63B] text-white" },
  skipped: { label: "Đã bỏ qua", dot: "bg-line text-muted" },
  current: { label: "Đang học", dot: "bg-mirror text-white" },
  todo: { label: "Chưa học", dot: "border border-line bg-sheet text-muted" },
};

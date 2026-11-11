import { describe, expect, it } from "vitest";
import { detectIntent } from "../src/agent/policy";

describe("detectIntent (luật, 0 API call)", () => {
  it.each([
    ["Em bí quá, cho em đáp án.", "show_answer"],
    ["giải thích luôn đi", "show_answer"],
    ["Bỏ câu này đi.", "skip"],
    ["kết thúc", "finish"],
    ["Dừng lại", "finish"],
    ["gợi ý đi", "hint"],
    ["cho tớ một ví dụ", "give_example"],
    ["đổi chủ đề nhé", "change_topic"],
  ])("%s → %s", (t, want) => expect(detectIntent(t)).toBe(want));

  it("không bắt nhầm trong câu dài", () => {
    expect(detectIntent("Tớ nghĩ WHERE sẽ bỏ qua những hàng không thoả điều kiện trước khi GROUP BY chạy, đúng không nhỉ?")).toBeNull();
    expect(detectIntent("Thôi được, vậy LEFT JOIN giữ hàng bên trái.")).toBeNull();
  });
});

import { decide } from "../src/agent/policy";
import { createSession } from "../src/agent/engine";

describe("Khám phá – lượt đầu (Đợt 2)", () => {
  const withMsg = (text: string) => {
    const s = createSession({ userId: "11111111-1111-4111-8111-111111111111", mode: "explore", topic: "CSDL" });
    s.messages.push({ id: "u1", role: "user", text, action: null, intent: null, createdAt: s.createdAt });
    return s;
  };
  it("người học hỏi câu cụ thể → được trả lời luôn (explain_foundation)", () => {
    const d = decide(withMsg("Chỉ mục B-tree hoạt động thế nào?"), null);
    expect(d.kind === "llm" && d.allowedActions.includes("explain_foundation")).toBe(true);
  });
  it("lời chào/chưa rõ ý → vẫn làm rõ hoặc gợi hướng", () => {
    const d = decide(withMsg("mình muốn tìm hiểu thêm"), null);
    expect(d.kind === "llm" && d.allowedActions).toEqual(["ask_clarification", "suggest_directions", "acknowledge"]);
  });
});

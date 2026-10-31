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

import { describe, expect, it } from "vitest";
import { findQuoteSource } from "../src/agent/evidence";
import type { Message } from "../src/agent/types";

const msgs: Message[] = [
  { id: "a1", role: "assistant", text: "LEFT JOIN giữ toàn bộ hàng bảng trái.", action: null, intent: null, createdAt: "" },
  { id: "u1", role: "user", text: "Nó chỉ lấy những dòng trùng nhau ở hai bảng.", action: null, intent: null, createdAt: "" },
  { id: "u2", role: "user", text: "INNER JOIN chỉ giữ những hàng ghép được, còn LEFT JOIN giữ cả hàng bên trái dù không khớp.", action: null, intent: null, createdAt: "" },
];

describe("evidence validator", () => {
  it("chấp nhận trích nguyên văn", () => {
    expect(findQuoteSource("chỉ lấy những dòng trùng nhau", msgs)).toBe("u1");
  });
  it("bỏ qua khác biệt hoa/thường, dấu câu, ngoặc kép", () => {
    expect(findQuoteSource("“LEFT JOIN giữ cả hàng bên trái”", msgs)).toBe("u2");
  });
  it("hỗ trợ trích có dấu ...", () => {
    expect(findQuoteSource("INNER JOIN chỉ giữ ... LEFT JOIN giữ cả hàng bên trái", msgs)).toBe("u2");
  });
  it("từ chối quote bịa", () => {
    expect(findQuoteSource("LEFT JOIN trả về NULL cho cột bên phải", msgs)).toBeNull();
  });
  it("từ chối quote lấy từ lời AI", () => {
    expect(findQuoteSource("giữ toàn bộ hàng bảng trái", msgs)).toBeNull();
  });
  it("từ chối quote quá ngắn", () => {
    expect(findQuoteSource("JOIN", msgs)).toBeNull();
  });
});

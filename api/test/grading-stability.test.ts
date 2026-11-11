import { describe, expect, it } from "vitest";
import { GeminiProvider, GRADING_SEED } from "../src/providers/gemini";

describe("chấm điểm ổn định (Đợt 4 – GU-02)", () => {
  const g = new GeminiProvider({ apiKey: "k", model: "gemini-test" });

  it("lời gọi temperature 0 (chấm điểm) gửi seed cố định", () => {
    const b: any = g.body({ system: "s", user: "u", temperature: 0 });
    expect(b.generationConfig.temperature).toBe(0);
    expect(b.generationConfig.seed).toBe(GRADING_SEED);
    expect(g.body({ system: "s", user: "u", temperature: 0 })).toEqual(b); // cùng đầu vào → cùng request
  });

  it("lời gọi hội thoại (temperature > 0) không bị gắn seed", () => {
    const b: any = g.body({ system: "s", user: "u", temperature: 0.4 });
    expect(b.generationConfig.seed).toBeUndefined();
    expect((g.body({ system: "s", user: "u" }) as any).generationConfig.seed).toBeUndefined();
  });
});

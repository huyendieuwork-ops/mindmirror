import { describe, expect, it } from "vitest";
import { accuracy, cohenKappa, consistency, majority, overClaimRate, underClaimRate, macroF1, mrr, falseContradictionRate, type Label } from "../scripts/lib/metrics";

const gold: Label[] = ["observed", "observed", "contradicted", "unclear", "unclear", "contradicted"];
const pred: Label[] = ["observed", "unclear", "contradicted", "observed", "unclear", "unclear"];

describe("chỉ số Agent Evals", () => {
  it("accuracy / over-claim / under-claim", () => {
    expect(accuracy(gold, pred)).toBeCloseTo(3 / 6);
    expect(overClaimRate(gold, pred)).toBeCloseTo(1 / 4); // 1 trong 4 ca không-observed bị nói là observed
    expect(underClaimRate(gold, pred)).toBeCloseTo(1 / 2);
    expect(falseContradictionRate(gold, pred)).toBe(0);
  });
  it("kappa = 1 khi khớp hoàn toàn, ≈0 khi ngẫu nhiên-như", () => {
    expect(cohenKappa(gold, gold)).toBe(1);
    expect(cohenKappa(["observed", "unclear"], ["unclear", "observed"])).toBeLessThan(0);
  });
  it("macro-F1 bỏ qua nhãn không xuất hiện", () => {
    expect(macroF1(["observed", "observed"], ["observed", "observed"])).toBe(1);
  });
  it("nhất quán & đa số (hoà → thận trọng)", () => {
    expect(consistency([["observed", "observed", "observed"], ["observed", "unclear", "observed"]])).toEqual({ allAgree: 0.5, meanAgreement: (1 + 2 / 3) / 2 });
    expect(majority(["observed", "unclear"])).toBe("unclear");
  });
  it("MRR", () => {
    expect(mrr([1, 2, null])).toBeCloseTo((1 + 0.5) / 3);
  });
});

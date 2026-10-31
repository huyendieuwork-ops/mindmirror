/**
 * Chỉ số cho AGENT EVALS — đo chính AI, không phải người học.
 */
export type Label = "observed" | "unclear" | "contradicted";
export const LABELS: Label[] = ["observed", "unclear", "contradicted"];

export function confusion(gold: Label[], pred: Label[]): Record<Label, Record<Label, number>> {
  const m = Object.fromEntries(LABELS.map((g) => [g, Object.fromEntries(LABELS.map((p) => [p, 0]))])) as Record<Label, Record<Label, number>>;
  gold.forEach((g, i) => m[g][pred[i]!]++);
  return m;
}

export function accuracy(gold: Label[], pred: Label[]): number {
  return gold.length ? gold.filter((g, i) => g === pred[i]).length / gold.length : 0;
}

export function macroF1(gold: Label[], pred: Label[]): number {
  const f1s = LABELS.map((l) => {
    const tp = gold.filter((g, i) => g === l && pred[i] === l).length;
    const fp = gold.filter((g, i) => g !== l && pred[i] === l).length;
    const fn = gold.filter((g, i) => g === l && pred[i] !== l).length;
    if (tp + fp + fn === 0) return null; // nhãn không xuất hiện → không tính
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    return p + r ? (2 * p * r) / (p + r) : 0;
  }).filter((x): x is number => x !== null);
  return f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;
}

/** Cohen's kappa: mức đồng thuận vượt trên ngẫu nhiên giữa AI và người chấm. */
export function cohenKappa(a: Label[], b: Label[]): number {
  const n = a.length;
  if (!n) return 0;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = LABELS.reduce((s, l) => s + (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/**
 * Over-claim: AI nói người học ĐÃ thể hiện (observed) trong khi người chấm nói chưa.
 * Đây là lỗi nguy hiểm nhất với MindMirror (tạo cảm giác "đã hiểu" giả).
 */
export function overClaimRate(gold: Label[], pred: Label[]): number {
  const neg = gold.map((g, i) => [g, pred[i]] as const).filter(([g]) => g !== "observed");
  return neg.length ? neg.filter(([, p]) => p === "observed").length / neg.length : 0;
}

/** Bỏ sót: người học đã thể hiện đúng nhưng AI không ghi nhận. */
export function underClaimRate(gold: Label[], pred: Label[]): number {
  const pos = gold.map((g, i) => [g, pred[i]] as const).filter(([g]) => g === "observed");
  return pos.length ? pos.filter(([, p]) => p !== "observed").length / pos.length : 0;
}

/** Nói người học SAI trong khi họ đúng — gây nản, cũng cần theo dõi. */
export function falseContradictionRate(gold: Label[], pred: Label[]): number {
  const pos = gold.map((g, i) => [g, pred[i]] as const).filter(([g]) => g === "observed");
  return pos.length ? pos.filter(([, p]) => p === "contradicted").length / pos.length : 0;
}

/** Nhất quán: chạy lại cùng một ca nhiều lần, tỉ lệ ca cho kết quả giống hệt nhau. */
export function consistency(runs: Label[][]): { allAgree: number; meanAgreement: number } {
  if (!runs.length) return { allAgree: 0, meanAgreement: 0 };
  let all = 0, mean = 0;
  for (const r of runs) {
    const mode = majority(r);
    if (r.every((x) => x === r[0])) all++;
    mean += r.filter((x) => x === mode).length / r.length;
  }
  return { allAgree: all / runs.length, meanAgreement: mean / runs.length };
}

export function majority(r: Label[]): Label {
  // hoà phiếu → chọn nhãn THẬN TRỌNG hơn (unclear) để không thổi phồng
  const order: Label[] = ["unclear", "contradicted", "observed"];
  let best: Label = "unclear", n = -1;
  for (const l of order) {
    const c = r.filter((x) => x === l).length;
    if (c > n) { best = l; n = c; }
  }
  return best;
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export function mrr(ranks: (number | null)[]): number {
  return ranks.length ? ranks.reduce<number>((a, r) => a + (r ? 1 / r : 0), 0) / ranks.length : 0;
}

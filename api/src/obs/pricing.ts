/**
 * Bảng giá tham khảo (USD / 1M tokens) — theo tài liệu kỹ thuật, snapshot 31/10/2026.
 * Chỉ để ƯỚC TÍNH chi phí trong trace; Free Tier thực tế không trừ tiền.
 * Ghi đè bằng biến môi trường PRICING_JSON nếu giá thay đổi.
 */
export type PriceTable = Record<string, { input: number; output: number }>;

export const DEFAULT_PRICES: PriceTable = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number, table: PriceTable = DEFAULT_PRICES): number {
  const p = table[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function loadPrices(json?: string): PriceTable {
  if (!json) return DEFAULT_PRICES;
  try { return { ...DEFAULT_PRICES, ...JSON.parse(json) }; } catch { return DEFAULT_PRICES; }
}

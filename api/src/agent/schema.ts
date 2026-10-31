import { z } from "zod";

export const ACTIONS = [
  "ask_clarification",
  "ask_explain",
  "ask_why",
  "suggest_directions",
  "give_hint",
  "explain_foundation",
  "give_example",
  "transfer_question",
  "show_answer",
  "acknowledge",
  "summarize",
] as const;

// Output của 1 lượt Agent. Model trả JSON này; backend validate + kiểm chứng.
export const TurnOutputSchema = z.object({
  next_action: z.enum(ACTIONS),
  assistant_text: z.string().min(1).max(2500),
  observed_evidence: z
    .array(
      z.object({
        criterion: z.string().min(1).max(80),
        claim: z.string().min(1).max(200),
        quote: z.string().min(1).max(400),
        status: z.enum(["observed", "unclear", "contradicted"]),
        // Khi có tài liệu: tiêu chí rubric (C1..) và đoạn nguồn làm căn cứ cho phán đoán
        criterion_id: z.string().max(10).nullable().optional(),
        source_ref: z.object({ source: z.string().max(6), quote: z.string().min(1).max(400) }).nullable().optional(),
      }),
    )
    .max(5)
    .default([]),
  suspected_gaps: z.array(z.string().min(1).max(120)).max(3).default([]),
  resolved_gaps: z.array(z.string().min(1).max(120)).max(3).default([]),
  hint_level: z.number().int().min(0).max(3).default(0),
  needs_source: z.boolean().default(false),
  ready_for_transfer: z.boolean().default(false),
  suggest_mode_switch: z.enum(["explore", "reunderstand"]).nullable().default(null),
  // Trích dẫn cho các nhận xét kiến thức trong assistant_text (đánh dấu [S1] trong lời)
  source_citations: z.array(z.object({ source: z.string().max(6), quote: z.string().min(1).max(400) })).max(4).default([]),
  // Model tự báo – chỉ lưu tham khảo, KHÔNG dùng để chấm.
  confidence: z.enum(["low", "medium", "high"]).default("low"),
});
export type TurnOutput = z.infer<typeof TurnOutputSchema>;

export const CardOutputSchema = z.object({
  initial_thought: z.string().max(400).nullable().default(null),
  demonstrated: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        evidence_ids: z.array(z.string()).min(1).max(5),
      }),
    )
    .max(6)
    .default([]),
  changed: z.string().max(400).nullable().default(null),
  unresolved: z.array(z.string().min(1).max(200)).max(5).default([]),
  next_step: z.string().min(1).max(300),
});
export type CardOutput = z.infer<typeof CardOutputSchema>;

export const PlanOutputSchema = z.object({
  criteria: z
    .array(
      z.object({
        concept: z.string().min(1).max(120),
        expectation: z.string().min(1).max(300),
        source: z.string().max(6),
        quote: z.string().min(1).max(400),
      }),
    )
    .max(6)
    .default([]),
  opening_question: z.string().min(1).max(600),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export const SummaryOutputSchema = z.object({
  summary: z.string().min(1).max(1200),
});

/** Bóc JSON khỏi text model trả (có thể có ```json fence). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("NO_JSON");
  }
}

import { ModelRouter } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";

export function turnOut(o: Partial<Record<string, unknown>> = {}) {
  return {
    next_action: "ask_why",
    assistant_text: "Cậu dựa vào đâu để nói vậy?",
    observed_evidence: [],
    suspected_gaps: [],
    resolved_gaps: [],
    hint_level: 0,
    needs_source: false,
    ready_for_transfer: false,
    suggest_mode_switch: null,
    confidence: "medium",
    ...o,
  };
}

/** Nhãn S? của đoạn tài liệu ở trang `page` trong prompt (giống model thật đọc <sources>). */
export function aliasForPage(user: string, page: number): string {
  const m = new RegExp(`<source id="(S\\d+)"[^>]*page="${page}"`).exec(user);
  if (!m) throw new Error(`không thấy trang ${page} trong <sources>`);
  return m[1]!;
}

export function scripted(script: Array<object | string | Error | ((req: any) => object)>) {
  const p = new ScriptedProvider(script as any);
  const router = new ModelRouter(p, null, { sleep: async () => {} });
  return { p, router };
}

let n = 0;
export const seqId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

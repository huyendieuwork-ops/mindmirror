import { type LLMProvider, type LLMRequest, type LLMResponse, ProviderError } from "./types";

export type ScriptItem = object | string | ProviderError | ((req: LLMRequest) => object | string);

/**
 * Provider trả lời theo kịch bản — dùng cho unit test/eval offline. Mỗi phần tử: object JSON, chuỗi thô, lỗi, hoặc hàm đọc prompt.
 * Phần tử dạng { tool_calls: [{ name, args }] } mô phỏng model yêu cầu gọi công cụ (function calling).
 */
export class ScriptedProvider implements LLMProvider {
  readonly calls: LLMRequest[] = [];
  readonly supportsTools = true;
  constructor(
    private script: ScriptItem[],
    readonly provider = "scripted",
    readonly model = "scripted-1",
    /** true: ước lượng token theo độ dài prompt (≈4 ký tự/token) để eval offline đo được lượng context. */
    readonly estimateTokens = false,
  ) {}
  async generateJSON(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    let next = this.script.shift();
    if (next === undefined) throw new Error("ScriptedProvider: hết kịch bản");
    if (next instanceof ProviderError) throw next;
    if (typeof next === "function") next = next(req);
    const promptChars = req.system.length + req.user.length + JSON.stringify(req.toolExchanges ?? []).length;
    const usage = { inputTokens: this.estimateTokens ? Math.ceil(promptChars / 4) : 10, outputTokens: 10 };
    if (typeof next === "object" && next && Array.isArray((next as any).tool_calls)) {
      const toolCalls = (next as any).tool_calls.map((c: any) => ({ name: String(c.name), args: c.args ?? {} }));
      return { text: "", toolCalls, rawModelParts: toolCalls.map((c: any) => ({ functionCall: c })), provider: this.provider, model: this.model, latencyMs: 1, usage };
    }
    if (typeof next === "object" && next && (next as any).__truncated) return { text: String((next as any).text), truncated: true, provider: this.provider, model: this.model, latencyMs: 1, usage };
    const text = typeof next === "string" ? next : JSON.stringify(next);
    return { text, provider: this.provider, model: this.model, latencyMs: 1, usage };
  }
}

/**
 * Provider offline cho demo SQL JOIN khi chưa có API key.
 * Heuristic đơn giản — KHÔNG phải trí tuệ thật, chỉ để chạy thử luồng state machine/UI.
 */
export class DemoProvider implements LLMProvider {
  readonly provider = "demo-offline";
  readonly model = "heuristic-v0";

  async generateJSON(req: LLMRequest): Promise<LLMResponse> {
    const u = req.user;
    const msg = /<current_user_message>([\s\S]*?)<\/current_user_message>/.exec(u)?.[1]?.trim() ?? "";
    const allowed: string[] = JSON.parse(/allowed_actions: (\[.*\])/.exec(u)?.[1] ?? '["acknowledge"]');
    const low = msg.toLowerCase();
    const pick = (...prefs: string[]) => prefs.find((p) => allowed.includes(p)) ?? allowed[0]!;

    // Thẻ cuối phiên
    if (req.system.includes("Thẻ Gương Hiểu Biết")) {
      const ids = [...u.matchAll(/"id":"([^"]+)","status":"observed"/g)].map((m) => m[1]!);
      return this.wrap({
        initial_thought: null,
        demonstrated: ids.length ? [{ text: "Diễn đạt được ý chính của khái niệm trong ví dụ của phiên.", evidence_ids: ids.slice(0, 2) }] : [],
        changed: null,
        unresolved: [],
        next_step: "Thử một ví dụ có nhiều bản ghi khớp (một–nhiều) mà không xem gợi ý.",
      });
    }
    if (req.system.includes("Tóm tắt ngắn")) return this.wrap({ summary: "Người học đang ôn chủ đề và đã trao đổi vài lượt." });

    // Lập kế hoạch kiểm tra từ tài liệu: lấy câu đầu mỗi đoạn làm căn cứ (nguyên văn)
    const sources = [...u.matchAll(/<source id="(S\d+)"[^>]*>([\s\S]*?)<\/source>/g)].map((m) => ({ id: m[1]!, text: m[2]! }));
    if (req.system.includes("KẾ HOẠCH KIỂM TRA")) {
      const criteria = sources.slice(0, 3).map((src) => {
        const body = src.text.includes(" — ") ? src.text.split(" — ").slice(1).join(" — ") : src.text;
        const words = body.split(/\s+/).filter(Boolean);
        const head = src.text.includes(" — ") ? src.text.split(" — ")[0]! : words.slice(0, 6).join(" ");
        return { concept: head.slice(0, 80), expectation: `Tự giải thích được: ${words.slice(0, 14).join(" ")}…`, source: src.id, quote: words.slice(0, 12).join(" ") };
      });
      return this.wrap({ criteria, opening_question: `Cậu thử giải thích “${criteria[0]?.concept ?? "chủ đề này"}” bằng lời của cậu nhé?` });
    }

    let out: Record<string, unknown> = {
      next_action: pick("ask_why", "acknowledge"),
      assistant_text: "Cậu dựa vào đâu để nói vậy? Thử cho mình một ví dụ nhỏ nhé.",
      observed_evidence: [], suspected_gaps: [], resolved_gaps: [], hint_level: 0,
      needs_source: false, ready_for_transfer: false, suggest_mode_switch: null, confidence: "low",
    };

    const action = pick(...allowed);
    if (["show_answer", "give_example", "explain_foundation", "give_hint", "transfer_question"].includes(allowed[0]!) && allowed.length === 1) {
      out.next_action = action;
      const join = /JOIN/i.test(u);
      out.assistant_text = (join ? {
        show_answer: "LEFT JOIN giữ TẤT CẢ hàng của bảng bên trái; hàng nào không khớp thì cột bên phải là NULL. INNER JOIN chỉ giữ các hàng khớp ở cả hai bảng. Cậu muốn thử một câu kiểm chứng không?",
        give_example: "Ví dụ minh hoạ: bảng khách hàng có Lan, Nam, An; bảng đơn hàng chỉ có đơn của Lan. LEFT JOIN khách hàng với đơn hàng sẽ ra mấy dòng? Cậu thử đoán nhé.",
        explain_foundation: "Nhắc nhanh: JOIN ghép hàng theo điều kiện ON. Khác biệt nằm ở chỗ hàng KHÔNG khớp được xử lý thế nào. Cậu thử áp dụng lại vào LEFT JOIN xem?",
        give_hint: "Gợi ý: nếu một khách hàng chưa có đơn nào, cậu nghĩ họ có biến mất khỏi kết quả LEFT JOIN không?",
        transfer_question: "Tình huống mới: bảng nhân viên LEFT JOIN bảng phòng ban, có nhân viên chưa được xếp phòng. Kết quả có chứa nhân viên đó không, cột tên phòng sẽ là gì?",
      } : {
        show_answer: "(Bản demo offline chưa có model thật nên chưa soạn được lời giải.) Khi nối Gemini, MindMirror sẽ giải thích đầy đủ dựa trên tài liệu của cậu.",
        give_example: "Ví dụ minh hoạ (demo): thử nghĩ một trường hợp nhỏ nhất mà điều cậu vừa nói KHÔNG còn đúng — đó là gì?",
        explain_foundation: "Nhắc nhanh (demo): quay lại định nghĩa trong tài liệu, gạch chân từng điều kiện, rồi so với cách cậu diễn đạt.",
        give_hint: "Gợi ý: đặt câu cậu vừa nói cạnh định nghĩa trong tài liệu — chỗ nào hai bên khác nhau?",
        transfer_question: "Tình huống mới (demo): áp dụng điều cậu vừa giải thích vào một ví dụ khác mà cậu tự đặt ra xem?",
      })[allowed[0]!] as string;
      return this.wrap(out);
    }

    if (/chỉ lấy|chỉ giữ/.test(low) && /(trùng|khớp|giống)/.test(low) && !/inner/.test(low)) {
      out = { ...out, next_action: pick("ask_why", "give_hint"),
        assistant_text: "Mình chưa chắc chỗ này. Nếu có một khách hàng chưa đặt đơn nào, LEFT JOIN có giữ lại khách hàng đó không?",
        observed_evidence: [{ criterion: "left_join_keeps_left_rows", claim: "Cho rằng LEFT JOIN chỉ lấy hàng khớp", quote: msg.slice(0, 120), status: "contradicted" }],
        suspected_gaps: ["Phân biệt LEFT JOIN với INNER JOIN"] };
    } else if (/(giữ|vẫn còn|vẫn có)/.test(low) && /(bên trái|bảng trái|trái)/.test(low)) {
      out = { ...out, next_action: pick("transfer_question", "acknowledge"),
        assistant_text: "Cậu đã nói đúng trọng tâm trong ví dụ này. Mình thử thêm một trường hợp khác để kiểm tra vận dụng nhé?",
        observed_evidence: [{ criterion: "left_join_keeps_left_rows", claim: "Giải thích LEFT JOIN giữ toàn bộ hàng bảng trái", quote: msg.slice(0, 120), status: "observed" }],
        resolved_gaps: ["Phân biệt LEFT JOIN với INNER JOIN"], ready_for_transfer: true, confidence: "medium" };
    } else if (/(không|chắc là không)/.test(low) && /(đơn|ghép|khớp)/.test(low)) {
      out = { ...out, next_action: pick("give_example", "give_hint", "explain_foundation"),
        assistant_text: "Mình thử một ví dụ minh hoạ nhé: bên trái có Lan, Nam, An; bảng đơn hàng chỉ có Lan. LEFT JOIN vẫn giữ cả ba người, đơn hàng của Nam và An là NULL. Cậu thử diễn đạt lại sự khác nhau giữa LEFT và INNER JOIN?",
        suspected_gaps: ["Phân biệt LEFT JOIN với INNER JOIN"], hint_level: 2 };
    }
    // Có tài liệu: demo KHÔNG tự chấm đúng/sai — chỉ ghi "unclear" + trích dẫn S1 để thử luồng hiển thị nguồn
    if (sources.length && out.observed_evidence && (out.observed_evidence as unknown[]).length === 0 && msg.length > 25) {
      const s1 = sources[0]!;
      const body = s1.text.includes(" — ") ? s1.text.split(" — ").slice(1).join(" — ") : s1.text;
      const quote = body.split(/\s+/).slice(0, 10).join(" ");
      out = {
        ...out,
        assistant_text: `${out.assistant_text} Tài liệu của cậu có viết về điểm này [S1] — cậu so lại với cách cậu vừa nói xem?`,
        source_citations: [{ source: "S1", quote }],
        observed_evidence: [{ criterion: "c1", claim: "Đã nêu cách hiểu (demo chưa chấm)", quote: msg.slice(0, 80), status: "unclear", criterion_id: "C1" }],
      };
    }
    return this.wrap(out);
  }

  private wrap(o: object): LLMResponse {
    return { text: JSON.stringify(o), provider: this.provider, model: this.model, latencyMs: 5, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

export { ProviderError };

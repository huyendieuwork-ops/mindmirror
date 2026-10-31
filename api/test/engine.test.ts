import { describe, expect, it } from "vitest";
import { AgentUnavailableError, createSession, runTurn } from "../src/agent/engine";
import { ProviderError } from "../src/providers/types";
import { scripted, seqId, turnOut } from "./helpers";

const USER = "11111111-1111-4111-8111-111111111111";
const newRe = () => createSession({ userId: USER, mode: "reunderstand", topic: "LEFT JOIN vs INNER JOIN" }, { id: seqId });

describe("mở phiên", () => {
  it("Hiểu lại: mời tự giải thích, không gọi model", () => {
    const s = newRe();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.text).toMatch(/giải thích theo cách cậu/);
    expect(s.state.phase).toBe("entry");
  });
  it("Khám phá: làm rõ điều tò mò", () => {
    const s = createSession({ userId: USER, mode: "explore", topic: "Vì sao đại dương màu xanh?" });
    expect(s.messages[0]!.text).toMatch(/tò mò/);
  });
});

describe("vòng lặp Agent", () => {
  it("code giới hạn hành động: đầu phiên Hiểu lại không được 'show_answer'", async () => {
    const { p, router } = scripted([
      turnOut({ next_action: "show_answer", assistant_text: "Đáp án là..." }),
      turnOut({ next_action: "ask_explain", assistant_text: "Cậu thử nói LEFT JOIN theo cách cậu nhớ nhé?" }),
    ]);
    const { result } = await runTurn(newRe(), { text: "Tớ hay nhầm LEFT JOIN với INNER JOIN." }, { core: router, id: seqId });
    expect(p.calls[0]!.user).toContain('allowed_actions: ["ask_explain","ask_clarification","ask_why"]');
    expect(p.calls[1]!.user).toMatch(/KHÔNG hợp lệ/); // yêu cầu viết lại 1 lần
    expect(result.action).toBe("ask_explain");
    expect(result.assistantText).toMatch(/theo cách cậu nhớ/);
  });

  it("model vẫn chọn sai sau khi sửa → ép nhãn về tập hợp lệ, không vòng lặp", async () => {
    const bad = turnOut({ next_action: "show_answer" });
    const { p, router } = scripted([bad, bad]);
    const { result } = await runTurn(newRe(), { text: "Tớ hay nhầm JOIN." }, { core: router, id: seqId });
    expect(p.calls).toHaveLength(2);
    expect(result.action).toBe("ask_explain");
  });

  it("loại bằng chứng bịa, giữ bằng chứng có thật", async () => {
    const { router } = scripted([
      turnOut({
        observed_evidence: [
          { criterion: "left_join", claim: "Nhầm LEFT với INNER", quote: "chỉ lấy những dòng trùng nhau", status: "contradicted" },
          { criterion: "null_cols", claim: "Biết cột NULL", quote: "cột bên phải sẽ là NULL", status: "observed" },
        ],
        suspected_gaps: ["Phân biệt LEFT JOIN với INNER JOIN"],
      }),
    ]);
    const { session, result } = await runTurn(newRe(), { text: "Nó chỉ lấy những dòng trùng nhau ở hai bảng." }, { core: router, id: seqId });
    expect(result.newEvidence).toHaveLength(1);
    expect(result.newEvidence[0]!.status).toBe("contradicted");
    expect(session.state.phase).toBe("repair");
    expect(session.gaps[0]!.status).toBe("open");
  });

  it("'cho em đáp án' → ép show_answer, ghi nhận mức hỗ trợ 3", async () => {
    const { p, router } = scripted([turnOut({ next_action: "ask_why", assistant_text: "LEFT JOIN giữ mọi hàng bên trái..." })]);
    const { session, result } = await runTurn(newRe(), { text: "Em bí quá, cho em đáp án." }, { core: router, id: seqId });
    expect(result.action).toBe("show_answer");
    expect(session.state.answerShown).toBe(true);
    expect(session.state.hintLevel).toBe(3);
    expect(p.calls[0]!.user).toMatch(/KHÔNG hỏi vặn thêm/);
  });

  it("'bỏ câu này' → không gọi model, gap bị đánh dấu skipped", async () => {
    const { router: r1 } = scripted([turnOut({ suspected_gaps: ["WHERE vs HAVING"] })]);
    const a = await runTurn(newRe(), { text: "WHERE với HAVING giống nhau mà" }, { core: r1, id: seqId });
    const { p, router: r2 } = scripted([]);
    const b = await runTurn(a.session, { text: "Bỏ câu này đi." }, { core: r2, id: seqId });
    expect(p.calls).toHaveLength(0);
    expect(b.result.action).toBe("skip");
    expect(b.session.gaps[0]!.status).toBe("skipped");
    expect(b.session.state.hintLevel).toBe(0);
  });

  it("2 vòng chưa tiến triển trên cùng gap → đổi cách hỗ trợ (không hỏi Socratic nữa)", async () => {
    const gap = { suspected_gaps: ["Phân biệt LEFT JOIN với INNER JOIN"] };
    const { p, router } = scripted([turnOut(gap), turnOut(gap), turnOut({ ...gap, next_action: "give_example", assistant_text: "Ví dụ nhỏ..." })]);
    let s = newRe();
    s = (await runTurn(s, { text: "Nó chỉ lấy dòng trùng nhau." }, { core: router, id: seqId })).session;
    s = (await runTurn(s, { text: "Chắc là không giữ, vì không có đơn để ghép." }, { core: router, id: seqId })).session;
    expect(s.state.roundOnSameGap).toBe(2);
    const r = await runTurn(s, { text: "Tớ vẫn chưa rõ lắm." }, { core: router, id: seqId });
    expect(p.calls[2]!.user).toContain('allowed_actions: ["explain_foundation","give_example"]');
    expect(r.result.action).toBe("give_example");
    expect(r.session.state.roundOnSameGap).toBe(0); // đã đổi hình thức hỗ trợ → đếm lại
  });

  it("bằng chứng sau hỗ trợ được gắn 'assisted', gap → resolved_after_support", async () => {
    const gap = "Phân biệt LEFT JOIN với INNER JOIN";
    const { router } = scripted([
      turnOut({ suspected_gaps: [gap] }),
      turnOut({ next_action: "give_example", assistant_text: "Ví dụ: Lan, Nam, An...", suspected_gaps: [gap] }),
      turnOut({
        next_action: "transfer_question",
        observed_evidence: [{ criterion: "left_join_keeps_left_rows", claim: "LEFT JOIN giữ hàng trái", quote: "LEFT JOIN giữ cả hàng bên trái dù không khớp", status: "observed" }],
        resolved_gaps: [gap], ready_for_transfer: true,
      }),
    ]);
    let s = newRe();
    s = (await runTurn(s, { text: "Nó chỉ lấy dòng trùng nhau." }, { core: router, id: seqId })).session;
    s = (await runTurn(s, { text: "cho tớ một ví dụ" }, { core: router, id: seqId })).session;
    expect(s.state.supportCount).toBe(1);
    const r = await runTurn(s, { text: "INNER JOIN chỉ giữ hàng ghép được, còn LEFT JOIN giữ cả hàng bên trái dù không khớp." }, { core: router, id: seqId });
    expect(r.result.newEvidence[0]!.assisted).toBe(true);
    expect(r.session.gaps[0]!.status).toBe("resolved_after_support");
    expect(r.session.state.phase).toBe("transfer");
  });

  it("không cho 'resolved' khi không có bằng chứng thật", async () => {
    const gap = "WHERE vs HAVING";
    const { router } = scripted([turnOut({ suspected_gaps: [gap] }), turnOut({ resolved_gaps: [gap], ready_for_transfer: true })]);
    let s = newRe();
    s = (await runTurn(s, { text: "HAVING với WHERE như nhau" }, { core: router, id: seqId })).session;
    const r = await runTurn(s, { text: "đúng" }, { core: router, id: seqId });
    expect(r.session.gaps[0]!.status).toBe("open");
    expect(r.session.state.phase).not.toBe("transfer");
  });

  it("guardrail: xoá câu khẳng định '% hiểu'", async () => {
    const { router } = scripted([turnOut({ assistant_text: "Cậu đã hiểu khoảng 90% rồi. Thử một ví dụ nhé?" })]);
    const r = await runTurn(newRe(), { text: "LEFT JOIN giữ hàng bên trái" }, { core: router, id: seqId });
    expect(r.result.assistantText).not.toMatch(/90%/);
    expect(r.result.assistantText).toMatch(/Thử một ví dụ/);
  });

  it("JSON lỗi → sửa 1 lần", async () => {
    const { p, router } = scripted(["không phải json", turnOut({ assistant_text: "Đã sửa" })]);
    const r = await runTurn(newRe(), { text: "LEFT JOIN là gì nhỉ" }, { core: router, id: seqId });
    expect(r.result.assistantText).toBe("Đã sửa");
    expect(p.calls).toHaveLength(2);
  });

  it("model chết → AgentUnavailableError, session gốc không bị đổi", async () => {
    const { router } = scripted([new ProviderError("down", 503, "x"), new ProviderError("down", 503, "x")]);
    const s = newRe();
    const before = JSON.stringify(s);
    await expect(runTurn(s, { text: "abc def" }, { core: router, id: seqId })).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("hết lượt → không gọi model, đề nghị tổng kết", async () => {
    const s = newRe();
    s.state.turnCount = 12;
    const { p, router } = scripted([]);
    const r = await runTurn(s, { text: "tiếp đi" }, { core: router, id: seqId });
    expect(p.calls).toHaveLength(0);
    expect(r.result.action).toBe("limit_reached");
  });

  it("đề xuất đổi chế độ chỉ là gợi ý; người dùng bấm mới chuyển", async () => {
    const s = createSession({ userId: USER, mode: "explore", topic: "Database" });
    const { router } = scripted([turnOut({ next_action: "acknowledge", suggest_mode_switch: "reunderstand" })]);
    const a = await runTurn(s, { text: "Tớ nghĩ LEFT JOIN chỉ lấy dòng khớp" }, { core: router, id: seqId });
    expect(a.session.state.mode).toBe("explore");
    expect(a.result.quickReplies[0]).toBe("switch_mode");
    const b = await runTurn(a.session, { text: "", intent: "switch_mode" }, { core: scripted([]).router, id: seqId });
    expect(b.session.state.mode).toBe("reunderstand");
  });
});

describe("Thẻ Gương Hiểu Biết", () => {
  it("dừng sớm, không có bằng chứng → không gọi model, ghi 'chưa đủ căn cứ'", async () => {
    const { p, router } = scripted([turnOut()]);
    let s = (await runTurn(newRe(), { text: "ừ" }, { core: router, id: seqId })).session;
    const r = await runTurn(s, { text: "kết thúc" }, { core: router, id: seqId });
    expect(p.calls).toHaveLength(1); // chỉ lượt "ừ"
    expect(r.result.isFinished).toBe(true);
    expect(r.result.card!.insufficientEvidence).toBe(true);
    expect(r.result.card!.demonstrated).toHaveLength(0);
  });

  it("model viết lời văn nhưng mục không có evidence hợp lệ / có '%' bị loại", async () => {
    const { router } = scripted([
      turnOut({ observed_evidence: [{ criterion: "c1", claim: "LEFT JOIN giữ hàng trái", quote: "LEFT JOIN giữ hàng bên trái", status: "observed" }] }),
    ]);
    const a = await runTurn(newRe(), { text: "LEFT JOIN giữ hàng bên trái nhé" }, { core: router, id: seqId });
    const evId = a.session.evidence[0]!.id;
    const { router: r2 } = scripted([
      {
        initial_thought: "bịa",
        demonstrated: [
          { text: "Giải thích đúng LEFT JOIN giữ hàng trái", evidence_ids: [evId] },
          { text: "Thành thạo subquery", evidence_ids: ["khong-ton-tai"] },
          { text: "Hiểu 95% về JOIN", evidence_ids: [evId] },
        ],
        changed: null, unresolved: [], next_step: "Thử ví dụ một–nhiều.",
      },
    ]);
    const r = await runTurn(a.session, { text: "", intent: "finish" }, { core: r2, id: seqId });
    const card = r.result.card!;
    expect(card.generatedBy).toBe("model");
    expect(card.demonstrated.map((d) => d.text)).toEqual(["Giải thích đúng LEFT JOIN giữ hàng trái"]);
    expect(card.initialThought).toBe("LEFT JOIN giữ hàng bên trái"); // trích thật, không lấy chữ model
    expect(card.insufficientEvidence).toBe(false);
  });
});

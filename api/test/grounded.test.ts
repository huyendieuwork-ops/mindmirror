import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, prepareGroundedSession, runTurn } from "../src/agent/engine";
import { assessLearner } from "../src/agent/assessment";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { Trace } from "../src/obs/tracer";
import { aliasForPage, scripted, seqId, turnOut } from "./helpers";

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const U = "11111111-1111-4111-8111-111111111111";

/** Phiên "Hiểu lại 2NF" gắn giáo trình; kế hoạch từ model có 1 tiêu chí thật + 1 tiêu chí bịa. */
async function groundedSession(trace?: Trace) {
  const store = new MemoryStore();
  const { document } = await ingestDocument({ userId: U, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder: null });
  const retriever = new Retriever(store, null);
  const plan = {
    criteria: [
      { concept: "Dạng chuẩn 2 (2NF)", expectation: "Giải thích phụ thuộc đầy đủ vào khóa", source: "S1", quote: "mọi thuộc tính không khóa đều phụ thuộc đầy đủ vào khóa chính" },
      { concept: "Khóa ngoại", expectation: "bịa", source: "S1", quote: "khóa ngoại phải tham chiếu khóa chính bảng khác" },
    ],
    opening_question: "Cậu thử giải thích 2NF bằng lời của cậu nhé? [S1]",
  };
  const { router: planner } = scripted([plan]);
  const s0 = createSession({ userId: U, mode: "reunderstand", topic: "Dạng chuẩn 2 (2NF)", documentIds: [document.id] }, { id: seqId });
  const s = await prepareGroundedSession(s0, { core: planner, retriever, trace });
  return { s, retriever, store };
}

describe("RAG trong vòng lặp Agent", () => {
  it("kế hoạch kiểm tra bám tài liệu: chỉ giữ tiêu chí có căn cứ thật", async () => {
    const { s } = await groundedSession();
    expect(s.rubric).toHaveLength(1);
    expect(s.rubric[0]!.citation.page).toBe(44);
    expect(s.messages[0]!.text).toMatch(/Giáo trình Cơ sở dữ liệu/);
    expect(s.messages[0]!.text).not.toContain("[S1]");
  });

  it("prompt có rubric + đoạn tài liệu; nhận xét có trích dẫn hợp lệ được đánh số", async () => {
    const { s, retriever } = await groundedSession();
    const { p, router } = scripted([(req) => {
      const a = aliasForPage(req.user, 44);
      return turnOut({
        next_action: "ask_why",
        assistant_text: `Theo giáo trình, điều kiện là phụ thuộc đầy đủ [${a}]. Nếu khóa chỉ có một cột thì sao? [S7]`,
        source_citations: [{ source: a, quote: "phụ thuộc đầy đủ vào khóa chính" }, { source: "S2", quote: "câu không có trong tài liệu nào cả" }],
      });
    }]);
    const r = await runTurn(s, { text: "2NF là bảng không còn phụ thuộc bắc cầu." }, { core: router, retriever, id: seqId });
    expect(p.calls[0]!.user).toContain("<rubric");
    expect(p.calls[0]!.user).toContain('<source id="S1"');
    expect(p.calls[0]!.system).toContain("BÁM TÀI LIỆU");
    expect(r.result.assistantText).toBe("Theo giáo trình, điều kiện là phụ thuộc đầy đủ [1]. Nếu khóa chỉ có một cột thì sao?");
    expect(r.result.citations).toHaveLength(1);
    expect(r.result.citations[0]!.page).toBe(44);
  });

  it("nói người học SAI mà không chỉ ra căn cứ trong tài liệu → hạ xuống 'unclear'", async () => {
    const { s, retriever } = await groundedSession();
    const { router } = scripted([turnOut({
      observed_evidence: [{ criterion: "2nf", claim: "Nhầm 2NF với 3NF", quote: "không còn phụ thuộc bắc cầu", status: "contradicted", criterion_id: "C1" }],
    })]);
    const r = await runTurn(s, { text: "2NF là bảng không còn phụ thuộc bắc cầu." }, { core: router, retriever, id: seqId });
    expect(r.result.newEvidence[0]!.status).toBe("unclear");
  });

  it("có căn cứ thật → giữ 'contradicted' kèm trích dẫn trang", async () => {
    const { s, retriever } = await groundedSession();
    const { router } = scripted([(req) => turnOut({
      observed_evidence: [{
        criterion: "2nf", claim: "Nhầm 2NF với 3NF", quote: "không còn phụ thuộc bắc cầu", status: "contradicted", criterion_id: "C1",
        source_ref: { source: aliasForPage(req.user, 44), quote: "phụ thuộc đầy đủ vào khóa chính" },
      }],
      suspected_gaps: ["Phân biệt 2NF và 3NF"],
    })]);
    const r = await runTurn(s, { text: "2NF là bảng không còn phụ thuộc bắc cầu." }, { core: router, retriever, id: seqId });
    const ev = r.result.newEvidence[0]!;
    expect(ev.status).toBe("contradicted");
    expect(ev.criterionId).toBe("C1");
    expect(ev.sourceCitation?.page).toBe(44);
    expect(ev.context).toBe("explain");
  });
});

describe("Learner Assessment", () => {
  it("phân biệt: cần luyện → đúng sau hỗ trợ → vận dụng được ở câu mới", async () => {
    const { s: s0, retriever } = await groundedSession();
    const src = (req: any) => ({ source: aliasForPage(req.user, 44), quote: "phụ thuộc đầy đủ vào khóa chính" });
    const { router } = scripted([
      (req) => turnOut({ observed_evidence: [{ criterion: "2nf", claim: "nhầm", quote: "không còn phụ thuộc bắc cầu", status: "contradicted", criterion_id: "C1", source_ref: src(req) }], suspected_gaps: ["2NF"] }),
      turnOut({ next_action: "give_example", assistant_text: "Ví dụ DANGKY…", suspected_gaps: ["2NF"] }),
      turnOut({ next_action: "transfer_question", assistant_text: "Bảng mới…", observed_evidence: [{ criterion: "2nf", claim: "đúng", quote: "phụ thuộc vào cả khóa ghép", status: "observed", criterion_id: "C1" }], resolved_gaps: ["2NF"], ready_for_transfer: true }),
      turnOut({ next_action: "acknowledge", observed_evidence: [{ criterion: "2nf", claim: "vận dụng đúng", quote: "TenGV chỉ phụ thuộc MaGV", status: "observed", criterion_id: "C1" }] }),
    ]);
    let s = s0;
    s = (await runTurn(s, { text: "2NF là bảng không còn phụ thuộc bắc cầu." }, { core: router, retriever, id: seqId })).session;
    expect(assessLearner(s).criteria[0]!.status).toBe("needs_practice");
    s = (await runTurn(s, { text: "cho tớ một ví dụ" }, { core: router, retriever, id: seqId })).session;
    s = (await runTurn(s, { text: "À, cột không khóa phải phụ thuộc vào cả khóa ghép chứ không phải một phần." }, { core: router, retriever, id: seqId })).session;
    let a = assessLearner(s);
    expect(a.criteria[0]!.status).toBe("demonstrated_with_support");
    expect(a.criteria[0]!.applied).toBe(false);
    s = (await runTurn(s, { text: "Bảng đó không đạt 2NF vì TenGV chỉ phụ thuộc MaGV, là một phần của khóa." }, { core: router, retriever, id: seqId })).session;
    a = assessLearner(s);
    expect(a.criteria[0]!.applied).toBe(true);
    expect(a.grounded).toBe(true);
    expect(a.note).toMatch(/không phải điểm số/);
  });

  it("không có bằng chứng → insufficient_evidence, không suy diễn", async () => {
    const { s } = await groundedSession();
    const a = assessLearner(s);
    expect(a.criteria.map((c) => c.status)).toEqual(["insufficient_evidence"]);
  });
});

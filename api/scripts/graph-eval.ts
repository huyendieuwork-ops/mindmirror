/**
 * So sánh RAG thường với GraphRAG trên cùng bộ câu hỏi (Đợt 3) — offline, deterministic (BM25, không gọi API).
 *
 *   npm run eval:graph
 *
 * Đồ thị được dựng bằng ĐÚNG pipeline LangChain của sản phẩm; bước "LLM trích xuất" được mô phỏng bằng đồ thị gán tay
 * (eval/fixtures/csdl-graph.json) để số liệu đo phần TRUY XUẤT, không lẫn chất lượng trích xuất của model.
 *
 * Chỉ số mỗi câu hỏi (10 câu, mỗi câu có trang chuẩn + khái niệm nền chuẩn):
 *  - page recall: tỉ lệ trang chuẩn có trong ngữ cảnh đưa cho model.
 *  - prerequisite recall: tỉ lệ khái niệm nền chuẩn mà hệ thống chỉ ra được.
 *      RAG: tính là "chỉ ra" nếu trang định nghĩa khái niệm đó nằm trong top-4 (cách tính rộng tay cho RAG).
 *      GraphRAG: khái niệm đó có trong quan hệ CẦN_BIẾT_TRƯỚC (kèm câu căn cứ) trả về.
 *  - passages: số đoạn đưa vào prompt (chi phí ngữ cảnh).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { MemoryGraphStore } from "../src/graph/memory";
import { buildConceptGraph } from "../src/graph/build";
import { graphContext } from "../src/graph/retrieve";
import { ModelRouter } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";
import { graphFixture, fixtureExtractor } from "../eval/graph-fixture";

const U = "00000000-0000-4000-8000-0000000000a1";
const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const store = new MemoryStore();
const { document } = await ingestDocument({ userId: U, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder: null });
const retriever = new Retriever(store, null);
const graph = new MemoryGraphStore();
const router = new ModelRouter(new ScriptedProvider(Array.from({ length: 20 }, () => fixtureExtractor())), null, { sleep: async () => {} });
let calls = 0;
for (let i = 0; i < 5; i++) {
  const r = await buildConceptGraph({ userId: U, documentIds: [document.id], store, graph, router });
  calls += r.llmCalls;
  if (r.done) break;
}
const defPage = new Map(graphFixture.concepts.map((c) => [c.name, c.page]));

type Row = { id: string; query: string; rag: { pr: number; qr: number; n: number }; graphAuto: { pr: number; qr: number; n: number }; graphFocus: { pr: number; qr: number; n: number } };
const rows: Row[] = [];
const frac = (hit: number, total: number) => (total ? hit / total : 1);

for (const q of graphFixture.questions) {
  const hits = await retriever.search(U, [document.id], q.query, 4);
  const ragPages = new Set(hits.map((h) => h.chunk.page));
  const rag = {
    pr: frac(q.pages.filter((p) => ragPages.has(p)).length, q.pages.length),
    qr: frac(q.prerequisites.filter((c) => ragPages.has(defPage.get(c) ?? -1)).length, q.prerequisites.length),
    n: hits.length,
  };
  const score = async (concept: string | null) => {
    const g = await graphContext({ userId: U, documentIds: [document.id], query: q.query, concept, graph, retriever });
    const evidence = [...g.prerequisites, ...g.related.slice(0, 2)].map((r) => r.chunk);
    const pages = new Set([...hits, ...evidence].map((c) => c.chunk.page));
    // Định nghĩa của khái niệm nền nằm ở trang của nó → đồ thị cho biết "cần trang nào", lấy thêm đoạn định nghĩa.
    const pre = new Set(g.prerequisites.map((r) => r.fromName));
    for (const name of pre) pages.add(defPage.get(name) ?? null);
    const extra = [...pre].filter((n) => !hits.some((h) => h.chunk.page === defPage.get(n))).length;
    return {
      pr: frac(q.pages.filter((p) => pages.has(p)).length, q.pages.length),
      qr: frac(q.prerequisites.filter((c) => pre.has(c)).length, q.prerequisites.length),
      n: new Set([...hits, ...evidence].map((c) => c.chunk.id)).size + extra,
    };
  };
  rows.push({ id: q.id, query: q.query, rag, graphAuto: await score(null), graphFocus: await score(q.focus) });
}

const mean = (k: "rag" | "graphAuto" | "graphFocus", m: "pr" | "qr" | "n") => rows.reduce((a, r) => a + r[k][m], 0) / rows.length;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const summary = {
  questions: rows.length, graph: { concepts: graph.concepts.size, relations: graph.relations.length, buildCalls: calls },
  rag: { pageRecall: mean("rag", "pr"), prerequisiteRecall: mean("rag", "qr"), passages: mean("rag", "n") },
  graphRagAuto: { pageRecall: mean("graphAuto", "pr"), prerequisiteRecall: mean("graphAuto", "qr"), passages: mean("graphAuto", "n") },
  graphRagFocus: { pageRecall: mean("graphFocus", "pr"), prerequisiteRecall: mean("graphFocus", "qr"), passages: mean("graphFocus", "n") },
};
console.log(`Đồ thị: ${summary.graph.concepts} khái niệm, ${summary.graph.relations} quan hệ (dựng bằng ${calls} lần gọi mô phỏng)\n`);
console.log("| Cách | Page recall | Prerequisite recall | Số đoạn / câu |");
console.log("|---|---|---|---|");
for (const [name, s] of [["RAG thường (top-4)", summary.rag], ["GraphRAG — tự tìm hạt giống", summary.graphRagAuto], ["GraphRAG — biết khái niệm đang vướng", summary.graphRagFocus]] as const)
  console.log(`| ${name} | ${pct(s.pageRecall)} | ${pct(s.prerequisiteRecall)} | ${s.passages.toFixed(1)} |`);
console.log("\nTừng câu (page recall / prerequisite recall):");
for (const r of rows) console.log(`  ${r.id} RAG ${pct(r.rag.pr)}/${pct(r.rag.qr)} · Graph(tự) ${pct(r.graphAuto.pr)}/${pct(r.graphAuto.qr)} · Graph(vướng) ${pct(r.graphFocus.pr)}/${pct(r.graphFocus.qr)}  ${r.query}`);
mkdirSync("eval/reports", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`eval/reports/graph-eval-${stamp}.json`, JSON.stringify({ summary, rows }, null, 2));
console.log(`\n📄 eval/reports/graph-eval-${stamp}.json`);

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
 *  - passages: số đoạn đưa vào prompt (chi phí ngữ cảnh); hit@4, MRR (theo trang chuẩn), token ước tính, độ trễ truy xuất p50/p95.
 *  Chạy 3 lần (--runs=N) và báo độ lệch giữa các lần (tiêu chí GR-08).
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

type Metrics = { pr: number; qr: number; n: number; hit: number; rr: number; chars: number; ms: number };
type Row = { id: string; query: string; rag: Metrics; graphAuto: Metrics; graphFocus: Metrics };
const frac = (hit: number, total: number) => (total ? hit / total : 1);
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 3);

async function runOnce(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const q of graphFixture.questions) {
    const t0 = performance.now();
    const hits = await retriever.search(U, [document.id], q.query, 4);
    const ragMs = performance.now() - t0;
    const ragPages = new Set(hits.map((h) => h.chunk.page));
    const rankOf = (list: { chunk: { page: number | null } }[]) => { const i = list.findIndex((h) => q.pages.includes(h.chunk.page ?? -1)); return i < 0 ? 0 : 1 / (i + 1); };
    const rag: Metrics = {
      pr: frac(q.pages.filter((p) => ragPages.has(p)).length, q.pages.length),
      qr: frac(q.prerequisites.filter((c) => ragPages.has(defPage.get(c) ?? -1)).length, q.prerequisites.length),
      n: hits.length, hit: q.pages.some((p) => ragPages.has(p)) ? 1 : 0, rr: rankOf(hits),
      chars: hits.reduce((a, h) => a + h.chunk.text.length, 0), ms: ragMs,
    };
    const score = async (concept: string | null): Promise<Metrics> => {
      const t1 = performance.now();
      const g = await graphContext({ userId: U, documentIds: [document.id], query: q.query, concept, graph, retriever });
      const ms = performance.now() - t1;
      const evidence = [...g.prerequisites, ...g.related.slice(0, 2)].map((r) => r.chunk);
      const ctx = [...hits, ...evidence.filter((e) => !hits.some((h) => h.chunk.id === e.chunk.id))];
      const pages = new Set(ctx.map((c) => c.chunk.page));
      // Định nghĩa của khái niệm nền nằm ở trang của nó → đồ thị cho biết "cần trang nào", lấy thêm đoạn định nghĩa.
      const pre = new Set(g.prerequisites.map((r) => r.fromName));
      for (const name of pre) pages.add(defPage.get(name) ?? null);
      const extraPages = [...pre].map((n) => defPage.get(n)).filter((pg) => pg !== undefined && !ctx.some((c) => c.chunk.page === pg));
      const extraChars: number = extraPages.reduce<number>((a, pg) => a + (store.chunks.get(document.id)!.find((ch) => ch.page === pg)?.text.length ?? 0), 0);
      return {
        pr: frac(q.pages.filter((p) => pages.has(p)).length, q.pages.length),
        qr: frac(q.prerequisites.filter((c) => pre.has(c)).length, q.prerequisites.length),
        n: ctx.length + extraPages.length, hit: q.pages.some((p) => pages.has(p)) ? 1 : 0, rr: rankOf(ctx),
        chars: ctx.reduce((a, c) => a + c.chunk.text.length, 0) + extraChars, ms,
      };
    };
    rows.push({ id: q.id, query: q.query, rag, graphAuto: await score(null), graphFocus: await score(q.focus) });
  }
  return rows;
}

const runs: Row[][] = [];
for (let i = 0; i < RUNS; i++) runs.push(await runOnce());
const rows = runs[0]!;
type K = "rag" | "graphAuto" | "graphFocus";
const mean = (rs: Row[], k: K, m: keyof Metrics) => rs.reduce((a, r) => a + r[k][m], 0) / rs.length;
const pctl = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const agg = (k: K) => {
  const ms = runs.flatMap((rs) => rs.map((r) => r[k].ms));
  const perRun = runs.map((rs) => ({ pr: mean(rs, k, "pr"), qr: mean(rs, k, "qr"), hit: mean(rs, k, "hit"), mrr: mean(rs, k, "rr") }));
  const spread = Math.max(...(["pr", "qr", "hit", "mrr"] as const).map((m) => (Math.max(...perRun.map((x) => x[m])) - Math.min(...perRun.map((x) => x[m]))) * 100));
  return {
    pageRecall: mean(rows, k, "pr"), prerequisiteRecall: mean(rows, k, "qr"), hitAt4: mean(rows, k, "hit"), mrr: mean(rows, k, "rr"),
    passages: mean(rows, k, "n"), tokensEst: mean(rows, k, "chars") / 4, p50ms: pctl(ms, 50), p95ms: pctl(ms, 95), runSpreadPts: spread,
  };
};
const summary = {
  questions: rows.length, runs: RUNS, graph: { concepts: graph.concepts.size, relations: graph.relations.length, buildCalls: calls },
  rag: agg("rag"), graphRagAuto: agg("graphAuto"), graphRagFocus: agg("graphFocus"),
  costNote: "Truy xuất không gọi Gemini (BM25 + Neo4j/đồ thị) → chi phí model thêm/lượt = 0; chi phí phát sinh chỉ ở lượt trả lời do ngữ cảnh dài hơn (token ước tính = ký tự/4).",
};
const T = [["RAG thường (top-4)", summary.rag], ["GraphRAG — tự tìm hạt giống", summary.graphRagAuto], ["GraphRAG — biết khái niệm đang vướng", summary.graphRagFocus]] as const;
const table = [
  "| Cách | hit@4 | MRR | Page recall | Prerequisite recall | Số đoạn/câu | Token ngữ cảnh ≈ | p50 / p95 truy xuất | Lệch giữa các lần |",
  "|---|---|---|---|---|---|---|---|---|",
  ...T.map(([name, s]) => `| ${name} | ${pct(s.hitAt4)} | ${s.mrr.toFixed(2)} | ${pct(s.pageRecall)} | ${pct(s.prerequisiteRecall)} | ${s.passages.toFixed(1)} | ${Math.round(s.tokensEst)} | ${s.p50ms.toFixed(1)} / ${s.p95ms.toFixed(1)} ms | ${s.runSpreadPts.toFixed(1)} điểm |`),
];
console.log(`Đồ thị: ${summary.graph.concepts} khái niệm, ${summary.graph.relations} quan hệ (dựng bằng ${calls} lần gọi mô phỏng) · ${rows.length} câu × ${RUNS} lần chạy\n`);
console.log(table.join("\n"));
console.log("\nTừng câu (page recall / prerequisite recall):");
for (const r of rows) console.log(`  ${r.id} RAG ${pct(r.rag.pr)}/${pct(r.rag.qr)} · Graph(tự) ${pct(r.graphAuto.pr)}/${pct(r.graphAuto.qr)} · Graph(vướng) ${pct(r.graphFocus.pr)}/${pct(r.graphFocus.qr)}  ${r.query}`);
mkdirSync("eval/reports", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`eval/reports/graph-eval-${stamp}.json`, JSON.stringify({ summary, rows }, null, 2));
writeFileSync(`eval/reports/graph-eval-${stamp}.md`, [
  `# So sánh RAG thường và GraphRAG — ${stamp}`, "",
  `${rows.length} câu hỏi có nhãn (trang chuẩn + khái niệm nền chuẩn), ${RUNS} lần chạy, offline (BM25, đồ thị dựng bằng pipeline thật với bộ trích xuất mô phỏng).`, "",
  ...table, "", summary.costNote, "",
  "| Câu | RAG page/prereq | GraphRAG tự | GraphRAG vướng | Câu hỏi |", "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${pct(r.rag.pr)} / ${pct(r.rag.qr)} | ${pct(r.graphAuto.pr)} / ${pct(r.graphAuto.qr)} | ${pct(r.graphFocus.pr)} / ${pct(r.graphFocus.qr)} | ${r.query} |`),
].join("\n"));
console.log(`\n📄 eval/reports/graph-eval-${stamp}.md`);

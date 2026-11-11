/**
 * AGENT EVALS — kiểm tra CHÍNH AI có đánh giá người học chính xác, nhất quán, dựa trên bằng chứng không.
 * (Khác Learner Assessment: đó là tính năng sản phẩm đánh giá người học — src/agent/assessment.ts.)
 *
 *   npm run eval                          # tất cả bộ, 3 lần chạy/ca
 *   npm run eval -- --suite retrieval     # chỉ RAG (chạy offline được, không tốn quota)
 *   npm run eval -- --suite judgment --runs 5
 *   npm run eval -- --judge               # thêm LLM-as-judge chấm chất lượng câu hỏi
 *   npm run eval -- --ci                  # thoát mã 1 nếu trượt ngưỡng (dùng trong CI)
 *
 * Bộ dữ liệu: eval/fixtures/*.json (nhãn gold do nhóm chấm theo rubric). Báo cáo: eval/reports/.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createSession, runTurn, type EngineDeps } from "../src/agent/engine";
import { buildEmbedder, buildExporters, buildRouters, contentMode, type Env } from "../src/env";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { containsQuote } from "../src/rag/text";
import { exportTrace, Trace } from "../src/obs/tracer";
import type { Criterion, Session } from "../src/agent/types";
import {
  accuracy, cohenKappa, confusion, consistency, falseContradictionRate, macroF1, majority, mrr, overClaimRate, percentile, underClaimRate, type Label,
} from "./lib/metrics";

// ---------- cấu hình ----------
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1]! : d; };
const SUITE = opt("suite", "all");
const RUNS = Number(opt("runs", "3"));
const PACE_MS = Number(opt("pace-ms", "4200")); // free tier 15 RPM: giãn cách lời gọi để không tự gây 429
let lastCall = 0;
async function pace() {
  if (offline) return;
  const w = lastCall + PACE_MS - Date.now();
  if (w > 0) await new Promise((r) => setTimeout(r, w));
  lastCall = Date.now();
}
const GATES = { overClaimMax: 0.1, citationValidityMin: 0.9, consistencyMin: 0.8, retrievalHitAtKMin: 0.85, behaviorPassMin: 0.85, kappaMin: 0.6 };

const env: Env = { APP_ENV: "development" };
for (const f of ["wrangler.toml", ".dev.vars"]) if (existsSync(f))
  for (const l of readFileSync(f, "utf8").split("\n")) { const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/.exec(l); if (m && m[2]!.trim()) (env as any)[m[1]!] = m[2]!.trim(); }
for (const [k, v] of Object.entries(process.env)) if (v && /^(GEMINI|GROQ|CF_|MODEL_|LANGFUSE|LANGSMITH|TRACE_)/.test(k)) (env as any)[k] = v;

const { core, light, offline } = buildRouters(env);
const embedder = buildEmbedder(env);
const exporters = buildExporters(env);
if (offline) console.warn("⚠ Chưa có GEMINI_API_KEY → model là DemoProvider: số liệu judgment/behavior KHÔNG phản ánh chất lượng thật.\n");

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const U = "00000000-0000-4000-8000-0000000000e1";
const report: Record<string, any> = { startedAt: new Date().toISOString(), offline, model: env.MODEL_CORE ?? "gemini-3.8-flash", runs: RUNS, gates: GATES };
const failures: string[] = [];
const traces: Trace[] = [];

async function library(withEmbedder: boolean) {
  const store = new MemoryStore();
  const { document } = await ingestDocument({ userId: U, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder: withEmbedder ? embedder : null });
  return { store, document, retriever: new Retriever(store, withEmbedder ? embedder : null) };
}

// ---------- 1. Retrieval (RAG) ----------
async function retrievalSuite() {
  const gold: { query: string; gold_pages: number[] }[] = JSON.parse(readFileSync("eval/fixtures/retrieval.json", "utf8"));
  const out: Record<string, unknown> = {};
  for (const mode of embedder ? ["lexical", "hybrid"] : ["lexical"]) {
    const { document, retriever } = await library(mode === "hybrid");
    const K = 4;
    const ranks: (number | null)[] = [];
    for (const g of gold) {
      const hits = await retriever.search(U, [document.id], g.query, K);
      const r = hits.findIndex((h) => g.gold_pages.includes(h.chunk.page ?? -1));
      ranks.push(r >= 0 ? r + 1 : null);
    }
    const res = {
      queries: gold.length,
      hitAt1: ranks.filter((r) => r === 1).length / gold.length,
      hitAtK: ranks.filter((r) => r !== null).length / gold.length,
      mrr: mrr(ranks),
      misses: gold.filter((_, i) => ranks[i] === null).map((g) => g.query),
    };
    out[mode] = res;
    console.log(`📚 Retrieval [${mode}] hit@1=${pct(res.hitAt1)} hit@${K}=${pct(res.hitAtK)} MRR=${res.mrr.toFixed(3)}${res.misses.length ? `  trượt: ${res.misses.join(" | ")}` : ""}`);
    if (res.hitAtK < GATES.retrievalHitAtKMin) failures.push(`retrieval ${mode} hit@${K} ${pct(res.hitAtK)} < ${pct(GATES.retrievalHitAtKMin)}`);
  }
  report.retrieval = out;
}

// ---------- 2. Judgment: AI chấm đúng người học không? ----------
interface JCase { id: string; criterion: { concept: string; expectation: string; page: number; quote: string }; answer: string; gold: Label; gold_alt?: Label }

async function judgmentSuite() {
  const cases: JCase[] = JSON.parse(readFileSync("eval/fixtures/judgments.json", "utf8"));
  const { store, document, retriever } = await library(!!embedder);
  const chunks = store.chunks.get(document.id)!;

  const perCase: { id: string; gold: Label; runs: Label[]; final: Label; firstText: string }[] = [];
  const faith = { proposed: 0, kept: 0, fakeQuote: 0, downgraded: 0, citesProposed: 0, citesValid: 0 };
  const latencies: number[] = [];
  let tokens = 0, cost = 0, errors = 0;

  for (const c of cases) {
    const chunk = chunks.find((x) => x.page === c.criterion.page && containsQuote(x.text, c.criterion.quote));
    if (!chunk) throw new Error(`fixture lỗi: không thấy quote của ${c.id} ở trang ${c.criterion.page}`);
    const criterion: Criterion = {
      id: "C1", concept: c.criterion.concept, expectation: c.criterion.expectation,
      citation: { chunkId: chunk.id, documentId: document.id, documentTitle: document.title, page: chunk.page, quote: c.criterion.quote },
    };
    const runs: Label[] = [];
    let firstText = "";
    for (let r = 0; r < RUNS; r++) {
      let s: Session = createSession({ userId: U, mode: "reunderstand", topic: c.criterion.concept, documentIds: [document.id] });
      s.rubric = [criterion];
      s.messages[0]!.text = `Cậu thử giải thích “${c.criterion.concept}” bằng lời của cậu nhé?`;
      const trace = new Trace("eval.judgment", { userId: U, sessionId: s.id, tags: ["eval", c.id], contentMode: contentMode(env) });
      traces.push(trace);
      try {
        await pace();
        const deps: EngineDeps = { core, light, retriever, trace };
        const out = await runTurn(s, { text: c.answer }, deps);
        s = out.session;
        firstText ||= out.result.assistantText;
        runs.push(labelOf(s));
      } catch {
        errors++; // lỗi hạ tầng (429/timeout) KHÔNG được tính là phán đoán "unclear" — loại khỏi chỉ số, báo riêng
      }
      trace.finish();
      const sum = trace.summary();
      latencies.push(sum.totalMs ?? 0);
      tokens += sum.inputTokens + sum.outputTokens;
      cost += sum.costUsd;
      const v = trace.data.spans.find((x) => x.name === "validate.output")?.attrs ?? {};
      faith.proposed += Number(v.evidence_proposed ?? 0);
      faith.kept += Number(v.evidence_kept ?? 0);
      faith.fakeQuote += Number(v.evidence_dropped_fake_quote ?? 0);
      faith.downgraded += Number(v.evidence_downgraded_no_source ?? 0);
      faith.citesProposed += Number(v.citations_proposed ?? 0);
      faith.citesValid += Number(v.citations_valid ?? 0);
    }
    if (runs.length) perCase.push({ id: c.id, gold: c.gold, runs, final: majority(runs), firstText });
  }

  const gold = perCase.map((p) => p.gold);
  const pred = perCase.map((p) => p.final);
  const cons = consistency(perCase.filter((p) => p.runs.length >= 2).map((p) => p.runs));
  const alt = cases.filter((c) => c.gold_alt);
  const res = {
    cases: cases.length,
    casesScored: perCase.length,
    accuracy: accuracy(gold, pred),
    macroF1: macroF1(gold, pred),
    kappaVsHuman: cohenKappa(gold, pred),
    humanHumanKappa: alt.length >= 5 ? cohenKappa(alt.map((c) => c.gold), alt.map((c) => c.gold_alt!)) : null,
    overClaimRate: overClaimRate(gold, pred),
    underClaimRate: underClaimRate(gold, pred),
    falseContradictionRate: falseContradictionRate(gold, pred),
    consistencyAllAgree: cons.allAgree,
    consistencyMeanAgreement: cons.meanAgreement,
    confusion: confusion(gold, pred),
    faithfulness: {
      evidenceProposed: faith.proposed,
      fakeQuoteRate: faith.proposed ? faith.fakeQuote / faith.proposed : 0,          // model bịa lời người học
      ungroundedJudgmentRate: faith.proposed ? faith.downgraded / faith.proposed : 0, // phán đúng/sai mà không có căn cứ tài liệu
      citationValidity: faith.citesProposed ? faith.citesValid / faith.citesProposed : null,
    },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    tokens, costUsd: Math.round(cost * 1e6) / 1e6, errors,
    wrong: perCase.filter((p) => p.final !== p.gold).map((p) => ({ id: p.id, gold: p.gold, pred: p.final, runs: p.runs })),
  };
  report.judgment = res;
  report.judgmentCases = perCase;

  console.log(`\n🧑‍⚖️  Judgment (${cases.length} ca × ${RUNS} lần)`);
  console.log(`   accuracy=${pct(res.accuracy)} macroF1=${res.macroF1.toFixed(2)} κ(AI,người chấm)=${res.kappaVsHuman.toFixed(2)}${res.humanHumanKappa !== null ? ` κ(người,người)=${res.humanHumanKappa.toFixed(2)}` : ""}`);
  console.log(`   over-claim=${pct(res.overClaimRate)}  bỏ sót=${pct(res.underClaimRate)}  chê sai người đúng=${pct(res.falseContradictionRate)}`);
  console.log(`   nhất quán: ${pct(res.consistencyAllAgree)} ca giống hệt nhau qua ${RUNS} lần (trung bình ${pct(res.consistencyMeanAgreement)})`);
  console.log(`   faithfulness: bịa quote ${pct(res.faithfulness.fakeQuoteRate)}, phán không căn cứ ${pct(res.faithfulness.ungroundedJudgmentRate)}, trích dẫn hợp lệ ${res.faithfulness.citationValidity === null ? "n/a" : pct(res.faithfulness.citationValidity)}`);
  console.log(`   p50=${res.latencyMs.p50}ms p95=${res.latencyMs.p95}ms tokens=${tokens} ~$${res.costUsd} lỗi=${errors}`);
  for (const w of res.wrong) console.log(`   ✗ ${w.id}: gold=${w.gold} pred=${w.pred} [${w.runs.join(",")}]`);

  if (res.overClaimRate > GATES.overClaimMax) failures.push(`over-claim ${pct(res.overClaimRate)} > ${pct(GATES.overClaimMax)}`);
  if (res.consistencyAllAgree < GATES.consistencyMin) failures.push(`consistency ${pct(res.consistencyAllAgree)} < ${pct(GATES.consistencyMin)}`);
  if (res.kappaVsHuman < GATES.kappaMin) failures.push(`kappa ${res.kappaVsHuman.toFixed(2)} < ${GATES.kappaMin}`);
  if (res.faithfulness.citationValidity !== null && res.faithfulness.citationValidity < GATES.citationValidityMin)
    failures.push(`citation validity ${pct(res.faithfulness.citationValidity)} < ${pct(GATES.citationValidityMin)}`);
}

/** Nhãn cuối mà HỆ THỐNG ghi nhận (sau mọi guardrail) cho tiêu chí C1. */
function labelOf(s: Session): Label {
  const ev = s.evidence.filter((e) => e.criterionId === "C1" || e.criterionId === null);
  if (ev.some((e) => e.status === "contradicted")) return "contradicted";
  if (ev.some((e) => e.status === "observed")) return "observed";
  return "unclear";
}

// ---------- 3. Behavior: tuân thủ chính sách sư phạm ----------
async function behaviorSuite() {
  type Case = { id: string; mode: "explore" | "reunderstand"; topic: string; source?: string; turns: string[];
    expect: { actionIn?: string[]; lastActionIn?: string[]; gapDetected?: boolean; noObservedEvidence?: boolean; cardInsufficient?: boolean; noPercent?: boolean; noLecture?: boolean } };
  const cases: Case[] = JSON.parse(readFileSync("eval/cases.json", "utf8"));
  let pass = 0;
  const rows: unknown[] = [];
  console.log(`\n🧭 Behavior (${cases.length} ca)`);
  for (const c of cases) {
    const store = new MemoryStore();
    const docIds: string[] = [];
    if (c.source) docIds.push((await ingestDocument({ userId: U, title: "Nguồn", kind: "text", pages: [{ page: 1, text: c.source }] }, { store, embedder: null })).document.id);
    let s = createSession({ userId: U, mode: c.mode, topic: c.topic, documentIds: docIds });
    const retriever = new Retriever(store, null);
    const actions: string[] = []; let card; const fails: string[] = []; let firstText = "";
    try {
      for (const t of c.turns) {
        await pace();
        const trace = new Trace("eval.behavior", { tags: ["eval", c.id], contentMode: contentMode(env) });
        traces.push(trace);
        const r = await runTurn(s, { text: t }, { core, light, retriever, trace });
        s = r.session; actions.push(r.result.action); card = r.result.card ?? card;
        firstText ||= r.result.assistantText;
        if (c.expect.noPercent && /\d{1,3}\s?%/.test(r.result.assistantText)) fails.push("có %");
      }
    } catch (e) { fails.push(`lỗi: ${(e as Error).message}`); }
    const e = c.expect;
    if (e.actionIn && !e.actionIn.includes(actions[0] ?? "")) fails.push(`action=${actions[0]}`);
    if (e.lastActionIn && !e.lastActionIn.includes(actions.at(-1) ?? "")) fails.push(`lastAction=${actions.at(-1)}`);
    if (e.gapDetected && s.gaps.length === 0) fails.push("không phát hiện gap");
    if (e.noObservedEvidence && s.evidence.some((x) => x.status === "observed")) fails.push("ghi observed khi người học không chắc");
    if (e.cardInsufficient && !card?.insufficientEvidence) fails.push("thẻ không ghi 'chưa đủ căn cứ'");
    if (e.noLecture && firstText.length > 600) fails.push(`giảng dài (${firstText.length} ký tự)`);
    if (!fails.length) pass++;
    rows.push({ id: c.id, actions, fails });
    console.log(`   ${fails.length ? "❌" : "✅"} ${c.id.padEnd(18)} ${actions.join(">")} ${fails.join("; ")}`);
  }
  report.behavior = { pass, total: cases.length, rate: pass / cases.length, rows };
  if (pass / cases.length < GATES.behaviorPassMin) failures.push(`behavior ${pass}/${cases.length}`);
}

// ---------- 4. (tuỳ chọn) LLM-as-judge chấm chất lượng câu hỏi ----------
async function judgeSuite() {
  const cases: { id: string; firstText: string }[] = report.judgmentCases ?? [];
  if (!cases.length) return;
  const scores: { id: string; grounded: number; focused: number; noLeak: number }[] = [];
  for (const c of cases) {
    try {
      const r = await core.generate({
        purpose: "judge", temperature: 0, maxOutputTokens: 200,
        system: 'Bạn là người chấm chất lượng phản hồi của một trợ lý học tập Socratic. Chấm 1–5 cho: grounded (bám tài liệu, có trích dẫn khi nhận xét kiến thức), focused (một câu hỏi trọng tâm, không giảng dài), no_leak (không đưa đáp án khi chưa được xin). Chỉ trả JSON {"grounded":n,"focused":n,"no_leak":n}.',
        user: `Phản hồi của trợ lý:\n${c.firstText}`,
      });
      const j = JSON.parse(r.text.replace(/```json|```/g, ""));
      scores.push({ id: c.id, grounded: j.grounded, focused: j.focused, noLeak: j.no_leak });
    } catch { /* bỏ qua ca lỗi */ }
  }
  const avg = (k: "grounded" | "focused" | "noLeak") => scores.reduce((a, s) => a + (Number(s[k]) || 0), 0) / (scores.length || 1);
  report.llmJudge = { n: scores.length, grounded: avg("grounded"), focused: avg("focused"), noLeak: avg("noLeak"), note: "LLM-as-judge chưa hiệu chỉnh: cần đối chiếu ≥20 ca với người chấm trước khi tin." };
  console.log(`\n🤖 LLM-as-judge (tham khảo): grounded=${avg("grounded").toFixed(2)} focused=${avg("focused").toFixed(2)} no_leak=${avg("noLeak").toFixed(2)}`);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------- chạy ----------
if (SUITE === "all" || SUITE === "retrieval") await retrievalSuite();
if (SUITE === "all" || SUITE === "judgment") await judgmentSuite();
if (SUITE === "all" || SUITE === "behavior") await behaviorSuite();
if (flag("judge")) await judgeSuite();

// Đẩy trace eval sang Langfuse/LangSmith (gắn tag "eval") để soi từng ca sai
await Promise.all(traces.map((t) => exportTrace(t, exporters)));

report.finishedAt = new Date().toISOString();
report.gateFailures = failures;
mkdirSync("eval/reports", { recursive: true });
const stamp = report.startedAt.replace(/[:.]/g, "-");
writeFileSync(`eval/reports/report-${stamp}.json`, JSON.stringify(report, null, 2));
console.log(`\n📄 eval/reports/report-${stamp}.json`);
if (failures.length) console.log(`\n⛔ Trượt ngưỡng:\n - ${failures.join("\n - ")}`);
const infra = (report as any).judgment?.errors ?? 0;
if (failures.length && infra >= 10) console.log(`⚠️  ${infra} lời gọi model lỗi (thường là 429 hết hạn mức) — kết quả lần này KHÔNG phản ánh chất lượng chấm; chạy lại khi hạn mức reset.`);
else if (!failures.length) console.log("\n✅ Đạt mọi ngưỡng.");
if (flag("ci") && failures.length) process.exit(1);

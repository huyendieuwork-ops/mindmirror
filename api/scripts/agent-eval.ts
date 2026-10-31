/**
 * AGENT EVALS (MVP) — guardrail · tool/permission · RAG/citation · workflow · Socratic (live).
 *
 *   npm run eval:agent                         # offline: mọi ca kiểm chứng được bằng code (0 API call, chạy lại y hệt)
 *   npm run eval:agent -- --live               # + ca cần model thật (GEMINI_API_KEY), mặc định tối đa 24 lời gọi
 *   npm run eval:agent -- --live --max-calls 40 --pace-ms 4200
 *   npm run eval:agent -- --ci                 # thoát mã 1 nếu ca offline trượt ngưỡng
 *
 * Ca offline dùng engine/tool/guardrail THẬT; chỗ cần "model" dùng ScriptedProvider để kiểm chứng phản ứng của hệ thống.
 * Ca live gọi Gemini thật, có giới hạn số lời gọi + giãn cách (free tier 15 RPM) — không chạy nếu thiếu key.
 * Kết quả: eval/reports/agent-eval-<thời gian>.json + .md (bảng dùng cho slide).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createSession, runTurn, AgentUnavailableError, type EngineDeps } from "../src/agent/engine";
import { checkUserInput } from "../src/agent/input-guard";
import { executeTool } from "../src/agent/tools";
import { answerOverlap } from "../src/agent/guardrails";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { aliasMap, validateCitation } from "../src/rag/grounding";
import { buildEmbedder, buildRouters, type Env } from "../src/env";
import { ModelRouter, type CallLog } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";
import { ProviderError } from "../src/providers/types";
import { Trace } from "../src/obs/tracer";
import { percentile } from "./lib/metrics";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1]! : d; };
const LIVE = flag("live");
const MAX_CALLS = Number(opt("max-calls", "24"));
const PACE_MS = Number(opt("pace-ms", "4200"));
const GATE_OFFLINE = 0.9;

const env: Env = { APP_ENV: "development" };
for (const f of ["wrangler.toml", ".dev.vars"]) if (existsSync(f))
  for (const l of readFileSync(f, "utf8").split("\n")) { const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/.exec(l); if (m && m[2]!.trim()) (env as any)[m[1]!] = m[2]!.trim(); }
for (const [k, v] of Object.entries(process.env)) if (v && /^(GEMINI|MODEL_|TRACE_)/.test(k)) (env as any)[k] = v;

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const { cases } = JSON.parse(readFileSync("eval/agent-cases.json", "utf8")) as { cases: any[] };
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
let idn = 0;
const seqId = () => `00000000-0000-4000-9000-${String(++idn).padStart(12, "0")}`;

async function library(userId = OWNER) {
  const store = new MemoryStore();
  const { document } = await ingestDocument({ userId, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder: null });
  return { store, document, retriever: new Retriever(store, null) };
}
const turn = (o: Record<string, unknown> = {}) => ({
  next_action: "ask_why", assistant_text: "Vì sao bạn nghĩ vậy?", observed_evidence: [], suspected_gaps: [], resolved_gaps: [], hint_level: 0,
  needs_source: false, ready_for_transfer: false, suggest_mode_switch: null, confidence: "medium", ...o,
});
const scriptedRouter = (script: any[], onCall?: (c: CallLog) => void) => {
  const p = new ScriptedProvider(script, "scripted", "scripted-1", true);
  return { p, router: new ModelRouter(p, null, { sleep: async () => {}, onCall }) };
};

type Row = { id: string; group: string; type: string; pass: boolean | null; detail: string; criteria: string; ms: number; tokens?: number; calls?: number };
const rows: Row[] = [];

// ---------------- offline evaluators ----------------
async function evalInput(c: any): Promise<[boolean, string]> {
  const v = checkUserInput(c.input, { maxChars: 3000, hasIntent: false });
  const want = (c.expect.flags ?? []) as string[];
  const got = v.flags.filter((f) => f !== "control_chars_removed");
  const kindOk = v.kind === c.expect.kind;
  const flagsOk = c.expect.flags === undefined || (want.every((f) => got.includes(f as any)) && got.every((f) => want.includes(f)));
  return [kindOk && flagsOk, `kind=${v.kind} flags=[${got.join(",")}]`];
}

async function evalToolPermission(c: any): Promise<[boolean, string]> {
  const { store, document, retriever } = await library(OWNER);
  const argsJson = JSON.parse(JSON.stringify(c.args).replace(/"\$DOC"/g, JSON.stringify(document.id)));
  const userId = c.as === "other" ? OTHER : OWNER;
  const r = await executeTool(c.tool, argsJson, { userId, store, retriever, initiator: c.initiator ?? "model" });
  if (c.expect.error) return [!r.ok && r.error.code === c.expect.error, r.ok ? "ok (mong đợi lỗi)" : `error=${r.error.code}`];
  const n = r.ok ? ((r.data as any).results?.length ?? -1) : -1;
  return [r.ok && n === c.expect.results, r.ok ? `ok results=${n}` : `error=${r.error.code}`];
}

async function evalAssessment(c: any): Promise<[boolean, string, { tokens: number; calls: number }]> {
  const { store, document, retriever } = await library();
  let calls = 0, tokens = 0;
  const { router } = scriptedRouter([(req: any) => {
    const m = { ...c.model };
    // Ca grounded: giữ nhãn nguồn hợp lệ nếu có để chỉ kiểm tra đúng quy tắc đang xét
    return turn(m);
  }], (l) => { calls++; tokens += l.inputTokens + l.outputTokens; });
  const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "CSDL", documentIds: c.grounded ? [document.id] : [] }, { id: seqId });
  const deps: EngineDeps = { core: router, id: seqId, retriever: c.grounded ? retriever : null, tools: c.grounded ? { store } : null };
  const { result } = await runTurn(s0, { text: c.answer }, deps);
  const e = c.expect;
  let pass = true; const notes: string[] = [];
  if (e.evidenceStatus) { const st = result.newEvidence[0]?.status ?? "none"; pass &&= st === e.evidenceStatus; notes.push(`evidence=${st}`); }
  if (e.evidenceCount !== undefined) { pass &&= result.newEvidence.length === e.evidenceCount; notes.push(`evidence_count=${result.newEvidence.length}`); }
  if (e.textNotMatch) { const bad = new RegExp(e.textNotMatch).test(result.assistantText); pass &&= !bad; notes.push(bad ? "câu vi phạm còn" : "đã loại câu vi phạm"); }
  notes.push(`guardrails=[${(result.guardrails ?? []).join(",")}]`);
  return [pass, notes.join(" "), { tokens, calls }];
}

async function evalCitation(c: any): Promise<[boolean, string]> {
  const { store, document } = await library();
  const chunks = store.chunks.get(document.id)!;
  const chunk = chunks.find((x) => x.page === c.page)!;
  const retrieved = [{ chunk, documentTitle: document.title, score: 1, lexicalRank: 1, vectorRank: null }];
  const v = validateCitation(c.alias ?? "S1", c.quote, aliasMap(retrieved));
  return [!!v === c.expect.valid, v ? "hợp lệ" : "bị loại"];
}

async function evalRetrieval(c: any): Promise<[boolean, string]> {
  const { document, retriever } = await library();
  const hits = await retriever.search(OWNER, [document.id], c.query, 4);
  const pages = hits.map((h) => h.chunk.page);
  if (c.expect.noRelevant) {
    // BM25 luôn trả "gần nhất"; điều quan trọng là grounding không cho trích dẫn câu không có trong đoạn.
    const fake = validateCitation("S1", "gradient descent cập nhật trọng số theo đạo hàm", aliasMap(hits));
    return [fake === null, `top pages=[${pages.join(",")}], trích dẫn bịa bị loại=${fake === null}`];
  }
  const rank = pages.findIndex((p) => c.expect.pages.includes(p ?? -1));
  return [rank >= 0, `rank=${rank >= 0 ? rank + 1 : "miss"} top=[${pages.join(",")}]`];
}

async function evalScenario(c: any): Promise<[boolean, string, { tokens: number; calls: number }]> {
  let calls = 0, tokens = 0;
  const onCall = (l: CallLog) => { calls++; tokens += l.inputTokens + l.outputTokens; };
  switch (c.scenario) {
    case "turn_limit": {
      const { p, router } = scriptedRouter(Array.from({ length: 20 }, (_, i) => turn({ assistant_text: `Câu hỏi khác số ${i}?` })), onCall);
      let s = createSession({ userId: OWNER, mode: "reunderstand", topic: "SQL" }, { id: seqId });
      const acts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await runTurn(s, { text: `trả lời ${i} về JOIN` }, { core: router, id: seqId, limits: { turnsPerSession: 4, maxRoundsSameGap: 2, maxAgentLedRounds: 6 } });
        s = r.session; acts.push(r.result.action);
      }
      return [p.calls.length === 3 && acts.slice(3).every((a) => a === "limit_reached"), `llm_calls=${p.calls.length}, lượt cuối=${acts.at(-1)}`, { tokens, calls }];
    }
    case "tool_loop_cap": {
      const { store, retriever } = await library();
      const tc = { tool_calls: [{ name: "search_learning_materials", args: { query: "khóa" } }] };
      const { p, router } = scriptedRouter([tc, tc, tc, tc, tc], onCall);
      const s0 = createSession({ userId: OWNER, mode: "explore", topic: "Khóa" }, { id: seqId });
      let threw = false;
      try { await runTurn(s0, { text: "tài liệu nói gì về khóa chính?" }, { core: router, id: seqId, retriever, tools: { store } }); } catch (e) { threw = e instanceof AgentUnavailableError; }
      return [p.calls.length <= 3 && threw, `llm_calls=${p.calls.length}, dừng an toàn=${threw}`, { tokens, calls }];
    }
    case "rate_limit": {
      const prov = new ScriptedProvider([1, 2, 3, 4].map(() => new ProviderError("rl", 429, "gemini")));
      const waits: number[] = [];
      const router = new ModelRouter(prov, null, { sleep: async (ms) => { waits.push(ms); } });
      const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "SQL" }, { id: seqId });
      let unavailable = false;
      try { await runTurn(s0, { text: "INNER JOIN lấy dòng khớp" }, { core: router, id: seqId }); } catch (e) { unavailable = e instanceof AgentUnavailableError; }
      const expo = waits.length === 2 && waits[1]! > waits[0]!;
      return [unavailable && prov.calls.length === 3 && expo, `attempts=${prov.calls.length}, waits=[${waits.join(",")}]ms`, { tokens, calls }];
    }
    case "skip_no_llm": {
      const { p, router } = scriptedRouter([], onCall);
      const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "SQL" }, { id: seqId });
      const r = await runTurn(s0, { text: "bỏ qua" }, { core: router, id: seqId });
      return [r.result.action === "skip" && p.calls.length === 0, `action=${r.result.action}, llm_calls=${p.calls.length}`, { tokens, calls }];
    }
    case "show_answer_forced": {
      const { router } = scriptedRouter([turn({ next_action: "ask_why" }), turn({ next_action: "ask_why" })], onCall);
      const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "3NF" }, { id: seqId });
      const r = await runTurn(s0, { text: "cho em xin đáp án luôn" }, { core: router, id: seqId });
      return [r.result.action === "show_answer", `action=${r.result.action}`, { tokens, calls }];
    }
    case "finish_insufficient": {
      const store = new MemoryStore();
      const { p, router } = scriptedRouter([], onCall);
      const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "SQL" }, { id: seqId });
      await store.createSession(s0);
      const r = await runTurn(s0, { text: "", intent: "finish" }, { core: router, id: seqId, tools: { store } });
      const ok = !!r.result.card?.insufficientEvidence && p.calls.length === 0 && r.result.cardSaved === true;
      return [ok, `insufficient=${r.result.card?.insufficientEvidence}, llm_calls=${p.calls.length}, saved=${r.result.cardSaved}`, { tokens, calls }];
    }
    case "tool_offering": {
      const { store, retriever } = await library();
      const empty = new MemoryStore();
      const probe = async (st: MemoryStore, text: string, prior = false) => {
        if (prior) await st.createSession(createSession({ userId: OWNER, mode: "reunderstand", topic: "Cũ" }, { id: seqId }));
        const { p, router } = scriptedRouter([turn()], onCall);
        const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "SQL" }, { id: seqId });
        await runTurn(s0, { text }, { core: router, id: seqId, retriever: new Retriever(st, null), tools: { store: st } });
        return (p.calls[0]?.tools ?? []).map((t) => t.name);
      };
      const a = await probe(empty, "Overfitting là gì?");
      const b = await probe(store, "Slide của em nói gì về 2NF?");
      const cc = await probe(store, "Lần trước em sai chỗ nào nhỉ?");
      void retriever;
      const ok = a.length === 0 && b.includes("search_learning_materials") && cc.includes("get_knowledge_gaps");
      return [ok, `không tài liệu=[${a}] | nhắc tài liệu=[${b}] | nhắc buổi trước=[${cc}]`, { tokens, calls }];
    }
    case "rag_tool_roundtrip": {
      const { store, retriever } = await library();
      const { p, router } = scriptedRouter([
        { tool_calls: [{ name: "search_learning_materials", args: { query: "phụ thuộc bắc cầu 3NF" } }] },
        (req: any) => {
          const hit = req.toolExchanges[0].results[0].response.results.find((r: any) => r.page === 45) ?? req.toolExchanges[0].results[0].response.results[0];
          return turn({ assistant_text: `Tài liệu của bạn nói [${hit.source_id}]. Bạn thử tìm phụ thuộc bắc cầu trong LOP?`, source_citations: [{ source: hit.source_id, quote: "phụ thuộc bắc cầu vào khóa chính" }] });
        },
      ], onCall);
      const s0 = createSession({ userId: OWNER, mode: "reunderstand", topic: "3NF" }, { id: seqId });
      const r = await runTurn(s0, { text: "Theo tài liệu của em thì 3NF là bỏ nhóm lặp phải không?" }, { core: router, id: seqId, retriever, tools: { store } });
      const ok = p.calls.length === 2 && r.result.citations.length === 1 && !!r.result.toolsUsed?.some((t) => t.name === "search_learning_materials" && t.ok);
      return [ok, `llm_calls=${p.calls.length}, citations=${r.result.citations.map((x) => `tr.${x.page}`).join(",")}`, { tokens, calls }];
    }
  }
  return [false, "kịch bản không xác định", { tokens, calls }];
}

// ---------------- live evaluators (model thật, có ngân sách) ----------------
let liveCalls = 0;
let lastCallAt = 0;
async function pace() {
  const wait = lastCallAt + PACE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function evalLive(c: any): Promise<[boolean | null, string, { tokens: number; calls: number; ms: number }]> {
  const onCallLog: CallLog[] = [];
  const { core, offline } = buildRouters(env, (l) => { onCallLog.push(l); liveCalls++; lastCallAt = Date.now(); });
  if (offline) return [null, "bỏ qua: chưa có GEMINI_API_KEY", { tokens: 0, calls: 0, ms: 0 }];
  const turns: string[] = c.type === "live_adapt" ? c.turns : [c.answer];
  if (liveCalls + turns.length * 2 > MAX_CALLS) return [null, `bỏ qua: hết ngân sách ${MAX_CALLS} lời gọi`, { tokens: 0, calls: 0, ms: 0 }];
  const lib = c.library ? await library() : null;
  let s = createSession({ userId: OWNER, mode: c.mode, topic: c.topic }, { id: seqId });
  const results = [];
  const t0 = Date.now();
  try {
    for (const t of turns) {
      await pace();
      const trace = new Trace("eval.agent.live", { tags: ["eval", c.id] });
      const r = await runTurn(s, { text: t }, { core, id: seqId, trace, retriever: lib?.retriever ?? null, tools: lib ? { store: lib.store } : null });
      s = r.session; results.push(r.result);
    }
  } catch (e) {
    return [false, `lỗi: ${(e as Error).message.slice(0, 120)}`, { tokens: sumTokens(onCallLog), calls: onCallLog.length, ms: Date.now() - t0 }];
  }
  const r = results.at(-1)!;
  const e = c.expect;
  const notes: string[] = [`action=${r.action}`];
  let pass = true;
  const statuses = r.newEvidence.map((x) => x.status);
  if (e.notObserved) { const bad = statuses.includes("observed"); pass &&= !bad; notes.push(`evidence=[${statuses}]`); }
  if (e.notContradicted) { const bad = statuses.includes("contradicted"); pass &&= !bad; notes.push(`evidence=[${statuses}]`); }
  if (e.socratic) {
    const isQ = /\?/.test(r.assistantText);
    const leak = c.reference ? answerOverlap(r.assistantText, c.reference) : 0;
    const okAct = ["ask_why", "ask_clarification", "ask_explain", "acknowledge", "give_hint", "give_example", "transfer_question"].includes(r.action);
    pass &&= isQ && leak < 0.6 && okAct && r.assistantText.length < 900;
    notes.push(`hỏi=${isQ} lộ_đáp_án=${leak.toFixed(2)} dài=${r.assistantText.length}`);
  }
  if (e.secondObserved) { const ok = results[1]!.newEvidence.some((x) => x.status === "observed") || ["transfer", "reflect"].includes(results[1]!.phase); pass &&= ok; notes.push(`lượt 2 evidence=[${results[1]!.newEvidence.map((x) => x.status)}] phase=${results[1]!.phase}`); }
  if (e.explainStructured) { const ok = /\n\s*[-*]|\|.+\||\*\*/.test(r.assistantText); pass &&= ok; notes.push(`có cấu trúc=${ok}`); }
  if (e.actionIn) { pass &&= e.actionIn.includes(r.action); }
  if (e.toolCalled) { const ok = !!r.toolsUsed?.some((t) => t.name === e.toolCalled && t.initiator === "model"); pass &&= ok; notes.push(`tools=[${(r.toolsUsed ?? []).map((t) => `${t.name}:${t.initiator}`)}]`); }
  if (e.noTool) { const ok = !r.toolsUsed?.some((t) => t.initiator === "model"); pass &&= ok; notes.push(`tools=[${(r.toolsUsed ?? []).map((t) => t.name)}]`); }
  return [pass, notes.join(" "), { tokens: sumTokens(onCallLog), calls: onCallLog.length, ms: Date.now() - t0 }];
}
const sumTokens = (l: CallLog[]) => l.reduce((a, x) => a + x.inputTokens + x.outputTokens, 0);

// ---------------- chạy ----------------
const startedAt = new Date().toISOString();
for (const c of cases) {
  const t0 = Date.now();
  let pass: boolean | null = false, detail = "", extra: { tokens?: number; calls?: number; ms?: number } = {};
  try {
    if (!c.offline) {
      if (!LIVE) { pass = null; detail = "chưa chạy (cần --live và GEMINI_API_KEY)"; }
      else [pass, detail, extra] = await evalLive(c);
    } else if (c.type === "input") [pass, detail] = await evalInput(c);
    else if (c.type === "tool_permission") [pass, detail] = await evalToolPermission(c);
    else if (c.type === "assessment") [pass, detail, extra] = await evalAssessment(c);
    else if (c.type === "citation") [pass, detail] = await evalCitation(c);
    else if (c.type === "retrieval") [pass, detail] = await evalRetrieval(c);
    else if (c.type === "scenario") [pass, detail, extra] = await evalScenario(c);
  } catch (e) {
    pass = false; detail = `lỗi: ${(e as Error).message.slice(0, 160)}`;
  }
  rows.push({ id: c.id, group: c.group, type: c.type, pass, detail, criteria: c.criteria, ms: extra.ms ?? Date.now() - t0, tokens: extra.tokens, calls: extra.calls });
  console.log(`${pass === null ? "⏭️ " : pass ? "✅" : "❌"} ${c.id.padEnd(6)} ${String(c.group).padEnd(10)} ${detail}`);
}

const groups = [...new Set(rows.map((r) => r.group))];
const summary = groups.map((g) => {
  const rs = rows.filter((r) => r.group === g);
  const ran = rs.filter((r) => r.pass !== null);
  return { group: g, total: rs.length, ran: ran.length, passed: ran.filter((r) => r.pass).length, rate: ran.length ? ran.filter((r) => r.pass).length / ran.length : null };
});
const offlineRows = rows.filter((r) => cases.find((c) => c.id === r.id)!.offline);
const offlineRate = offlineRows.filter((r) => r.pass).length / offlineRows.length;
const inputRows = rows.filter((r) => r.type === "input");
const liveRows = rows.filter((r) => r.pass !== null && !cases.find((c) => c.id === r.id)!.offline);
const report = {
  startedAt, finishedAt: new Date().toISOString(), live: LIVE, model: LIVE ? env.MODEL_CORE ?? "gemini-3.8-flash" : "scripted (offline)",
  totalCases: rows.length, offlineCases: offlineRows.length, offlinePassRate: offlineRate, summary,
  liveUsage: { calls: liveCalls, tokens: liveRows.reduce((a, r) => a + (r.tokens ?? 0), 0), latencyMs: { p50: percentile(liveRows.map((r) => r.ms), 50), p95: percentile(liveRows.map((r) => r.ms), 95) } },
  offlineTokensEstimated: offlineRows.reduce((a, r) => a + (r.tokens ?? 0), 0),
  inputGuard: { cases: inputRows.length, passed: inputRows.filter((r) => r.pass).length },
  rows,
};
mkdirSync("eval/reports", { recursive: true });
const stamp = startedAt.replace(/[:.]/g, "-");
writeFileSync(`eval/reports/agent-eval-${stamp}.json`, JSON.stringify(report, null, 2));
const md = [
  `# MindMirror Agent Evals — ${startedAt}`, "",
  `Chế độ: ${LIVE ? `offline + live (${report.model}, ${liveCalls} lời gọi)` : "offline (deterministic, không gọi API)"}`, "",
  "| Nhóm | Số ca | Đã chạy | Đạt | Tỉ lệ |", "|---|---|---|---|---|",
  ...summary.map((s) => `| ${s.group} | ${s.total} | ${s.ran} | ${s.passed} | ${s.rate === null ? "—" : `${Math.round(s.rate * 100)}%`} |`), "",
  "| Ca | Nhóm | Kết quả | Chi tiết | Tiêu chí |", "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${r.group} | ${r.pass === null ? "chưa chạy" : r.pass ? "ĐẠT" : "TRƯỢT"} | ${r.detail.replace(/\|/g, "/")} | ${r.criteria} |`),
].join("\n");
writeFileSync(`eval/reports/agent-eval-${stamp}.md`, md);
console.log(`\n${summary.map((s) => `${s.group}: ${s.passed}/${s.ran}${s.ran < s.total ? ` (chưa chạy ${s.total - s.ran})` : ""}`).join(" · ")}`);
console.log(`offline: ${Math.round(offlineRate * 100)}% (${offlineRows.filter((r) => r.pass).length}/${offlineRows.length})${LIVE ? ` · live: ${liveRows.filter((r) => r.pass).length}/${liveRows.length}, ${liveCalls} lời gọi` : ""}`);
console.log(`📄 eval/reports/agent-eval-${stamp}.md`);
if (flag("ci") && offlineRate < GATE_OFFLINE) { console.log(`⛔ offline ${Math.round(offlineRate * 100)}% < ${GATE_OFFLINE * 100}%`); process.exit(1); }

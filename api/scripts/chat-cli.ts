/**
 * Chat với Agent MindMirror ngay trong terminal — không cần frontend, DB hay đăng nhập.
 *
 *   npm run chat                       # hỏi chế độ + chủ đề
 *   npm run chat -- reunderstand "LEFT JOIN vs INNER JOIN"
 *
 * Có GEMINI_API_KEY (trong .dev.vars hoặc biến môi trường) → gọi Gemini thật (qua AI Gateway nếu có CF_ACCOUNT_ID/CF_GATEWAY_ID).
 * Không có → DemoProvider offline (heuristic cho ví dụ SQL JOIN, chỉ để thử luồng).
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createSession, prepareGroundedSession, runTurn, AgentUnavailableError } from "../src/agent/engine";
import { buildEmbedder, buildRouters, type Env } from "../src/env";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { Trace } from "../src/obs/tracer";
import type { Session, UserIntent } from "../src/agent/types";

function loadEnv(): Env {
  const env: Record<string, string> = {};
  for (const f of ["wrangler.toml", ".dev.vars"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/.exec(line);
      if (m && m[2]!.trim()) env[m[1]!] = m[2]!.trim();
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v && /^(GEMINI|GROQ|CF_|MODEL_)/.test(k)) env[k] = v;
  return { ...env, APP_ENV: "development" };
}

const CMDS: Record<string, UserIntent> = {
  "/hint": "hint", "/answer": "show_answer", "/example": "give_example", "/more": "explain_more",
  "/try": "try", "/skip": "skip", "/topic": "change_topic", "/mode": "switch_mode", "/finish": "finish",
};

const c = { dim: (s: string) => `\x1b[2m${s}\x1b[0m`, cyan: (s: string) => `\x1b[36m${s}\x1b[0m`, yel: (s: string) => `\x1b[33m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m` };

async function main() {
  const env = loadEnv();
  const usage = { calls: 0, inTok: 0, outTok: 0, fallback: 0 };
  const { core, light, offline } = buildRouters(env, (l) => {
    usage.calls++; usage.inTok += l.inputTokens; usage.outTok += l.outputTokens; if (l.fallback) usage.fallback++;
  });
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  // Hàng đợi dòng: chạy được cả khi gõ tay lẫn khi pipe kịch bản vào stdin.
  const queue: string[] = [];
  const waiters: ((l: string | null) => void)[] = [];
  let closed = false;
  rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : queue.push(l)));
  rl.on("close", () => { closed = true; while (waiters.length) waiters.shift()!(null); });
  const ask = (prompt: string): Promise<string | null> => {
    stdout.write(prompt);
    if (queue.length) { const l = queue.shift()!; if (!stdin.isTTY) stdout.write(l + "\n"); return Promise.resolve(l); }
    if (closed) return Promise.resolve(null);
    return new Promise((res) => waiters.push((l) => { if (l !== null && !stdin.isTTY) stdout.write(l + "\n"); res(l); }));
  };

  console.log(c.cyan("\n🪞 MindMirror — Agent CLI"), c.dim(offline ? "(chế độ OFFLINE demo — chưa có GEMINI_API_KEY)" : `(model: ${env.MODEL_CORE ?? "gemini-3.8-flash"})`));
  // npm run chat -- reunderstand "2NF" --doc eval/fixtures/csdl-chuan-hoa.json   (hoặc .txt, trang ngăn bằng \f)
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--doc");
  const docPath = di >= 0 ? argv[di + 1] : undefined;
  const [argMode, argTopic] = argv.filter((_, i) => i !== di && i !== di + 1);
  const mode = (argMode as Session["state"]["mode"]) ?? ((await ask("Chế độ [1] Khám phá  [2] Hiểu lại: "))?.trim() === "1" ? "explore" : "reunderstand");
  const topic = argTopic ?? ((await ask("Chủ đề: "))?.trim() || "SQL JOIN");

  const userId = "00000000-0000-4000-8000-000000000000";
  const store = new MemoryStore();
  const embedder = offline ? null : buildEmbedder(env);
  const retriever = new Retriever(store, embedder);
  const documentIds: string[] = [];
  if (docPath) {
    const raw = readFileSync(docPath, "utf8");
    const doc = docPath.endsWith(".json")
      ? JSON.parse(raw)
      : { title: docPath.split("/").pop(), kind: "text", pages: raw.split("\f").map((t, i) => ({ page: i + 1, text: t })) };
    const { document } = await ingestDocument({ userId, title: doc.title, kind: doc.kind, pages: doc.pages }, { store, embedder });
    documentIds.push(document.id);
    console.log(c.dim(`📄 Đã nạp “${document.title}”: ${document.pageCount} trang, ${document.chunkCount} đoạn, ${document.embedded ? "hybrid" : "từ khoá"}${document.warnings.length ? `, cảnh báo: ${document.warnings.join(", ")}` : ""}`));
  }
  let s = createSession({ userId, mode, topic, documentIds });
  if (documentIds.length) {
    s = await prepareGroundedSession(s, { core, retriever });
    if (s.rubric.length) console.log(c.dim("Tiêu chí kiểm tra từ tài liệu:\n" + s.rubric.map((r) => `  ${r.id}. ${r.concept} (tr. ${r.citation.page ?? "?"})`).join("\n")));
  }
  console.log(c.dim(`Lệnh: ${Object.keys(CMDS).join(" ")} /state /quit\n`));
  console.log(c.cyan("MindMirror:"), s.messages[0]!.text, "\n");

  while (s.status !== "finished") {
    const raw = await ask(c.green("Cậu: "));
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;
    if (line === "/quit") break;
    if (line === "/state") {
      console.log(c.dim(JSON.stringify({ state: s.state, gaps: s.gaps, evidence: s.evidence.map((e) => `[${e.status}${e.assisted ? ",assisted" : ""}] ${e.quote}`) }, null, 2)));
      continue;
    }
    const intent = CMDS[line] ?? null;
    try {
      const trace = new Trace("cli.turn");
      const r = await runTurn(s, { text: intent ? "" : line, intent }, { core, light, retriever, trace });
      s = r.session;
      const res = r.result;
      console.log(c.cyan("\nMindMirror:"), res.assistantText);
      console.log(c.dim(`  ↳ action=${res.action} phase=${res.phase} hint=${res.hintLevel}` +
        (res.newEvidence.length ? ` evidence=${res.newEvidence.map((e) => e.status).join(",")}` : "") +
        (res.suggestModeSwitch ? ` gợi-ý-đổi-chế-độ=${res.suggestModeSwitch}` : "") +
        (res.quickReplies.length ? `  nút: ${res.quickReplies.join(" ")}` : "")));
      for (const [i, ct] of res.citations.entries()) console.log(c.dim(`  [${i + 1}] ${ct.documentTitle}${ct.page ? `, tr. ${ct.page}` : ""}: “${ct.quote}”`));
      if (line === "/trace" || process.env.SHOW_TRACE) {
        const sm = trace.summary();
        console.log(c.dim(`  ⏱ ${sm.steps.map((x) => `${x.name}:${x.ms}ms`).join(" → ")} | llm=${sm.llmCalls} tokens=${sm.inputTokens}/${sm.outputTokens}`));
      }
      if (res.card) printCard(res.card);
      console.log();
    } catch (e) {
      if (e instanceof AgentUnavailableError) console.log(c.yel(`⚠ Tạm thời chưa thể phản hồi (${e.reason}). Thử gửi lại nhé.\n`));
      else throw e;
    }
  }
  console.log(c.dim(`Phiên kết thúc. Lượt gọi model: ${usage.calls}, tokens in/out: ${usage.inTok}/${usage.outTok}, fallback: ${usage.fallback}`));
  rl.close();
}

function printCard(card: NonNullable<Awaited<ReturnType<typeof runTurn>>["result"]["card"]>) {
  console.log(c.yel("\n┌─ 🪞 GƯƠNG HIỂU BIẾT ─ " + card.topic));
  if (card.initialThought) console.log(c.yel("│ Ban đầu cậu nói: ") + `“${card.initialThought}”`);
  if (card.demonstrated.length) {
    console.log(c.yel("│ Đã thể hiện:"));
    for (const d of card.demonstrated) console.log(`│  • ${d.text}${d.assisted ? c.dim(" [sau hỗ trợ]") : ""}`);
  } else console.log(c.yel("│ Đã thể hiện: ") + "chưa đủ bằng chứng");
  if (card.changed) console.log(c.yel("│ Thay đổi: ") + card.changed);
  if (card.unresolved.length) console.log(c.yel("│ Còn bỏ ngỏ: ") + card.unresolved.join("; "));
  console.log(c.yel("│ Bước tiếp: ") + card.nextStep);
  const label: Record<string, string> = { demonstrated_independent: "tự thể hiện", demonstrated_with_support: "đúng sau hỗ trợ", needs_practice: "cần luyện", insufficient_evidence: "chưa đủ căn cứ" };
  for (const a of card.assessment.criteria) console.log(c.yel("│ ▸ ") + `${a.concept}: ${label[a.status]}${a.applied ? " · đã vận dụng" : ""}${a.sourceCitation?.page ? c.dim(` (tr. ${a.sourceCitation.page})`) : ""}`);
  console.log(c.yel("└─ ") + c.dim(`(tạo bởi: ${card.generatedBy}; không phải điểm số)`));
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Mô phỏng bước "LLM trích khái niệm & quan hệ" bằng đồ thị gán tay (eval/fixtures/csdl-graph.json):
 * nhận khối <sources> mà pipeline LangChain gửi, trả JSON gồm các khái niệm/quan hệ có quote nằm trong lô đó,
 * gắn đúng nhãn S… — y như một model trích xuất tốt. Kèm 1 quan hệ BỊA để kiểm tra pipeline loại bỏ.
 * Dùng chung cho test/graph.test.ts, scripts/agent-eval.ts (nhóm graph) và scripts/graph-eval.ts.
 */
import { readFileSync } from "node:fs";
import { containsQuote } from "../src/rag/text";

export const graphFixture = JSON.parse(readFileSync(new URL("./fixtures/csdl-graph.json", import.meta.url), "utf8")) as {
  concepts: { name: string; description: string; page: number; quote: string }[];
  relations: { from: string; to: string; type: "CAN_BIET_TRUOC" | "LIEN_QUAN"; page: number; quote: string }[];
  fabricated: { from: string; to: string; type: "CAN_BIET_TRUOC" | "LIEN_QUAN"; page: number; quote: string }[];
  questions: { id: string; query: string; focus: string; prerequisites: string[]; pages: number[] }[];
};

/** Hàm "model" cho ScriptedProvider: req.user là khối <sources> của một lô. */
export function fixtureExtractor(opts: { includeFabricated?: boolean } = {}) {
  return (req: { user: string }) => {
    const sources = [...req.user.matchAll(/<source id="(S\d+)"[^>]*>([\s\S]*?)<\/source>/g)].map((m) => ({ id: m[1]!, text: m[2]! }));
    const find = (quote: string) => sources.find((s) => containsQuote(s.text, quote))?.id;
    const concepts = graphFixture.concepts.filter((c) => find(c.quote));
    const names = new Set(concepts.map((c) => c.name));
    const relations = graphFixture.relations.filter((r) => find(r.quote)).map((r) => ({ from: r.from, to: r.to, type: r.type, source: find(r.quote)!, quote: r.quote }));
    for (const r of relations) for (const n of [r.from, r.to]) if (!names.has(n)) { const c = graphFixture.concepts.find((x) => x.name === n)!; concepts.push(c); names.add(n); }
    const fab = opts.includeFabricated && sources.length
      ? graphFixture.fabricated.filter((r) => names.has(r.from)).map((r) => ({ from: r.from, to: r.to, type: r.type, source: sources[0]!.id, quote: r.quote }))
      : [];
    for (const r of fab) if (!names.has(r.to)) { concepts.push(graphFixture.concepts.find((x) => x.name === r.to)!); names.add(r.to); }
    return {
      concepts: concepts.map((c) => ({ name: c.name, description: c.description })),
      relations: [...relations, ...fab],
      mentions: concepts.filter((c) => find(c.quote)).map((c) => ({ concept: c.name, source: find(c.quote)!, quote: c.quote })),
    };
  };
}

/**
 * Kiểm kết nối Neo4j Aura thật (Đợt 3) — chạy trong CI khi repo có secret NEO4J_*, hoặc chạy tay:
 *   NEO4J_URI=... NEO4J_USERNAME=... NEO4J_PASSWORD=... npx tsx scripts/neo4j-check.ts
 * Dùng ĐÚNG Neo4jGraphStore của Worker (Query API HTTP). Ghi một đồ thị nhỏ dưới userId tạm "ci-smoke-…",
 * đọc lại (theo đúng tài khoản và tài khoản khác), rồi xoá sạch. Không đụng dữ liệu người dùng thật. Không in mật khẩu.
 */
import { buildGraphStore, type Env } from "../src/env";
import { queryEndpoint } from "../src/graph/neo4j";
import type { GraphStore } from "../src/graph/types";

const env = process.env as unknown as Env;
const store = buildGraphStore(env);
if (!store) {
  console.log("⏭️  Bỏ qua: chưa có đủ NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD.");
  process.exit(0);
}
console.log(`Neo4j endpoint: ${new URL(queryEndpoint(env.NEO4J_URI!, env.NEO4J_DATABASE?.trim() || "neo4j")).host}`);

const U = `ci-smoke-${Date.now()}`;
const OTHER = `${U}-other`;
const DOC = "00000000-0000-4000-8000-00000000c1a0";
const ev = (quote: string) => ({ documentId: DOC, documentTitle: "CI smoke", page: 45, chunkId: "00000000-0000-4000-8000-00000000c1a1", quote });
const checks: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push([name, ok, detail]); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function run(g: GraphStore) {
  check("ping (RETURN 1)", await g.ping());
  await g.ensureSchema();
  check("tạo index (IF NOT EXISTS)", true);
  await g.write({
    userId: U,
    documents: [{ id: DOC, title: "CI smoke" }],
    pages: [{ documentId: DOC, page: 45 }],
    concepts: [
      { key: "dạng chuẩn 2", name: "Dạng chuẩn 2 (2NF)", description: "", aliases: ["2nf"] },
      { key: "dạng chuẩn 3", name: "Dạng chuẩn 3 (3NF)", description: "", aliases: ["3nf"] },
    ],
    relations: [{ from: "dạng chuẩn 2", to: "dạng chuẩn 3", type: "CAN_BIET_TRUOC", evidence: ev("Một quan hệ ở dạng chuẩn 3 khi nó đạt 2NF") }],
    mentions: [
      { concept: "dạng chuẩn 2", evidence: ev("đạt 2NF") },
      { concept: "dạng chuẩn 3", evidence: ev("dạng chuẩn 3") },
    ],
  });
  const pages = await g.extractedPages(U, [DOC]);
  check("ghi + đọc trang đã trích", pages.has(`${DOC}:45`), [...pages].join(","));
  const nb = await g.neighborhood(U, [DOC], { keys: ["3nf"], pageKeys: [] });
  const pre = nb.relations.filter((r) => r.type === "CAN_BIET_TRUOC" && r.to === "dạng chuẩn 3").map((r) => r.fromName);
  check("tìm theo viết tắt 3NF → khái niệm nền 2NF có trang", pre.includes("Dạng chuẩn 2 (2NF)") && nb.relations.every((r) => r.evidence.page === 45), pre.join(","));
  const view = await g.view(U, [DOC]);
  check("xem đồ thị (Báo cáo)", view.concepts.length === 2 && view.relations.length === 1, `${view.concepts.length} khái niệm, ${view.relations.length} quan hệ`);
  const other = await g.neighborhood(OTHER, [], { keys: ["3nf"], pageKeys: [] });
  const otherView = await g.view(OTHER, []);
  check("tài khoản khác không thấy gì", other.seeds.length === 0 && otherView.concepts.length === 0);
  await g.deleteDocument(U, DOC);
  const after = await g.view(U, [DOC]);
  check("xoá tài liệu → xoá phần đồ thị", after.concepts.length === 0 && after.relations.length === 0);
}

try {
  await run(store);
} catch (e) {
  check("lỗi Neo4j", false, `${(e as { code?: string }).code ?? ""} ${(e as Error).message}`.slice(0, 200));
} finally {
  await store.deleteUser(U).catch(() => {});
  await store.deleteUser(OTHER).catch(() => {});
}
const failed = checks.filter((c) => !c[1]).length;
console.log(failed ? `\n${failed} kiểm tra trượt.` : `\nNeo4j OK (${checks.length} kiểm tra).`);
process.exit(failed ? 1 : 0);

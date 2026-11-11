/**
 * Kiểm kết nối Neo4j Aura thật (Đợt 3) — chạy trong CI khi repo có secret NEO4J_*, hoặc chạy tay:
 *   NEO4J_URI=... NEO4J_USERNAME=... NEO4J_PASSWORD=... npx tsx scripts/neo4j-check.ts
 * Dùng ĐÚNG Neo4jGraphStore của Worker (Query API HTTP). Ghi một đồ thị nhỏ dưới userId tạm "ci-smoke-…",
 * đọc lại (theo đúng tài khoản và tài khoản khác), rồi xoá sạch. Không đụng dữ liệu người dùng thật. Không in mật khẩu.
 */
import { buildGraphStore, type Env } from "../src/env";
import { queryEndpoint, Neo4jGraphStore } from "../src/graph/neo4j";
import type { GraphStore, GraphWrite } from "../src/graph/types";

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
  await g.write(sample());
}

function sample(): GraphWrite {
  return {
    userId: U,
    documents: [{ id: DOC, title: "CI smoke" }],
    pages: [{ documentId: DOC, page: 45 }],
    concepts: [
      { key: "dạng chuẩn 2", name: "Dạng chuẩn 2 (2NF)", description: "", aliases: ["2nf"] },
      { key: "dạng chuẩn 3", name: "Dạng chuẩn 3 (3NF)", description: "", aliases: ["3nf"] },
    ],
    relations: [{ from: "dạng chuẩn 2", to: "dạng chuẩn 3", type: "CAN_BIET_TRUOC" as const, evidence: ev("Một quan hệ ở dạng chuẩn 3 khi nó đạt 2NF") }],
    mentions: [
      { concept: "dạng chuẩn 2", evidence: ev("đạt 2NF") },
      { concept: "dạng chuẩn 3", evidence: ev("dạng chuẩn 3") },
    ],
  };
}

async function run2(g: GraphStore) {
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
  // NEO-04: nạp lại cùng dữ liệu → số nút/quan hệ không đổi (MERGE, khoá duy nhất theo userId + key).
  const db = g as Neo4jGraphStore;
  const count = async () => (await db.run<{ n: number; r: number }>(
    "MATCH (n {userId: $u}) OPTIONAL MATCH (n)-[r]->() RETURN count(DISTINCT n) AS n, count(r) AS r", { u: U }))[0]!;
  const before = await count();
  await g.write(sample());
  const again = await count();
  check("nạp lại cùng tài liệu → số nút/quan hệ không đổi (NEO-04)", before.n === again.n && before.r === again.r, `${before.n}/${before.r} → ${again.n}/${again.r}`);
  // NEO-01: lược đồ — chỉ các nhãn/quan hệ đã thiết kế.
  const labels = (await db.run<{ label: string }>("CALL db.labels() YIELD label RETURN label")).map((x) => x.label);
  const types = (await db.run<{ t: string }>("CALL db.relationshipTypes() YIELD relationshipType AS t RETURN t")).map((x) => x.t);
  const okLabels = labels.every((l) => ["KhaiNiem", "TaiLieu", "Trang"].includes(l)) && ["KhaiNiem", "TaiLieu", "Trang"].every((l) => labels.includes(l));
  const okTypes = types.every((t) => ["CAN_BIET_TRUOC", "LIEN_QUAN", "XUAT_HIEN_O", "THUOC"].includes(t)) && ["CAN_BIET_TRUOC", "LIEN_QUAN", "XUAT_HIEN_O"].every((t) => types.includes(t));
  check("lược đồ đúng: nhãn + quan hệ, không có loại lạ (NEO-01)", okLabels && okTypes, `nhãn=[${labels}] quan hệ=[${types}]`);
  // NEO-02 / NEO-03: toàn CSDL — không nút nào thiếu userId, không cạnh nào nối 2 tài khoản.
  const noUser = (await db.run<{ c: number }>("MATCH (n) WHERE n.userId IS NULL RETURN count(n) AS c"))[0]!.c;
  check("mọi nút gắn tài khoản: nút thiếu userId = 0 (NEO-02)", Number(noUser) === 0, `nút thiếu userId=${noUser}`);
  const cross = (await db.run<{ c: number }>("MATCH (a)-[r]->(b) WHERE a.userId <> b.userId RETURN count(r) AS c"))[0]!.c;
  check("không có cạnh xuyên tài khoản (NEO-03)", Number(cross) === 0, `cạnh xuyên tài khoản=${cross}`);
  await g.deleteDocument(U, DOC);
  const after = await g.view(U, [DOC]);
  const orphans = (await db.run<{ c: number }>("MATCH (n {userId: $u}) WHERE (n:KhaiNiem OR n:Trang) AND NOT (n)--() RETURN count(n) AS c", { u: U }))[0]!.c;
  check("xoá tài liệu → xoá phần đồ thị, 0 nút mồ côi (NEO-05)", after.concepts.length === 0 && after.relations.length === 0 && Number(orphans) === 0, `mồ côi=${orphans}`);
  await g.write(sample());
  await g.deleteUser(U);
  const left = (await db.run<{ c: number }>("MATCH (n {userId: $u}) RETURN count(n) AS c", { u: U }))[0]!.c;
  check("xoá tài khoản → 0 nút còn lại (NEO-05)", Number(left) === 0, `còn=${left}`);
}

try {
  await run(store);
  await run2(store);
} catch (e) {
  check("lỗi Neo4j", false, `${(e as { code?: string }).code ?? ""} ${(e as Error).message}`.slice(0, 200));
} finally {
  await store.deleteUser(U).catch(() => {});
  await store.deleteUser(OTHER).catch(() => {});
}
const failed = checks.filter((c) => !c[1]).length;
console.log(failed ? `\n${failed} kiểm tra trượt.` : `\nNeo4j OK (${checks.length} kiểm tra).`);
process.exit(failed ? 1 : 0);

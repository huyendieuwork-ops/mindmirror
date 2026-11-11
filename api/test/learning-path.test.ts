import { describe, expect, it } from "vitest";
import { createSession, prepareLearningPath, runTurn } from "../src/agent/engine";
import { rulesPath } from "../src/agent/path";
import { createApp } from "../src/http/app";
import { MemoryStore } from "../src/store/memory";
import { ModelRouter } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";
import { scripted, seqId, turnOut } from "./helpers";

const USER = "11111111-1111-4111-8111-111111111111";
const newPath = (level: "beginner" | "some" | "review" = "beginner") =>
  createSession({ userId: USER, mode: "explore", topic: "Chỉ mục trong CSDL", level }, { id: seqId });

const PLAN = { parts: [
  { title: "Chỉ mục là gì?", objective: "Nói được chỉ mục giúp tìm dòng nhanh hơn.", checkpoint: "Vì sao tra chỉ mục nhanh hơn quét cả bảng?" },
  { title: "Đánh đổi khi ghi", objective: "Biết chỉ mục làm thao tác ghi chậm hơn.", checkpoint: "Vì sao không nên tạo chỉ mục cho mọi cột?" },
  { title: "Chọn cột để đánh chỉ mục", objective: "Chọn được cột hay dùng để lọc.", checkpoint: "Bảng đơn hàng hay lọc theo ngày, bạn đánh chỉ mục cột nào?" },
] };

describe("Khám phá – học từ đầu: tạo phiên", () => {
  it("có trình độ → dàn ý dự phòng + câu mở đầu liệt kê các phần (0 lời gọi model)", () => {
    const s = newPath();
    expect(s.state.path?.stage).toBe("intro");
    expect(s.state.path?.parts.length).toBe(4);
    expect(s.state.path?.parts[0]!.status).toBe("current");
    expect(s.messages[0]!.text).toMatch(/từ con số 0/);
    expect(s.messages[0]!.text).toMatch(/kiểm tra nhanh/);
  });

  it("không có trình độ hoặc chế độ Kiểm tra → không có dàn ý (giữ hành vi cũ)", () => {
    expect(createSession({ userId: USER, mode: "explore", topic: "X" }).state.path).toBeNull();
    expect(createSession({ userId: USER, mode: "reunderstand", topic: "X", level: "beginner" }).state.path).toBeNull();
  });

  it("trình độ đổi số phần dự phòng", () => {
    expect(rulesPath("A", "some").parts.length).toBe(4);
    expect(rulesPath("A", "review").parts.length).toBe(3);
  });

  it("model đề xuất dàn ý hợp lệ → thay dàn ý dự phòng; sai định dạng → giữ dự phòng", async () => {
    const { router } = scripted([PLAN]);
    const s = await prepareLearningPath(newPath(), { core: router });
    expect(s.state.path?.generatedBy).toBe("model");
    expect(s.state.path?.parts.map((p) => p.title)).toEqual(PLAN.parts.map((p) => p.title));
    expect(s.messages[0]!.text).toContain("Đánh đổi khi ghi");

    const bad = scripted([{ parts: [{ title: "x" }] }]);
    const s2 = await prepareLearningPath(newPath(), { core: bad.router });
    expect(s2.state.path?.generatedBy).toBe("rules");
  });
});

describe("Khám phá – học từ đầu: giảng → kiểm tra → sang phần", () => {
  it("lượt đầu giảng Phần 1 và kết thúc bằng câu kiểm tra; code chuyển sang chờ trả lời", async () => {
    const { p, router } = scripted([PLAN, turnOut({ next_action: "explain_foundation", assistant_text: "Chỉ mục giống mục lục sách…\n\n**Kiểm tra nhanh:** Vì sao tra chỉ mục nhanh hơn?" })]);
    let s = await prepareLearningPath(newPath(), { core: router });
    const r = await runTurn(s, { text: "Bắt đầu" }, { core: router, id: seqId });
    const prompt = p.calls[1]!.user;
    expect(prompt).toMatch(/Phần 1\/3 “Chỉ mục là gì\?”/);
    expect(prompt).toMatch(/Kiểm tra nhanh/);
    expect(prompt).toContain('allowed_actions: ["explain_foundation","give_example"]');
    s = r.session;
    expect(s.state.path?.stage).toBe("check");
    expect(r.result.path?.current).toBe(0);
    expect(r.result.quickReplies).toEqual(["hint", "give_example", "show_answer", "skip"]);
  });

  it("trả lời ĐẠT → phần 1 done, sang phần 2 (đã hỏi câu kiểm tra phần 2)", async () => {
    const { p, router } = scripted([
      turnOut({ next_action: "explain_foundation", assistant_text: "…**Kiểm tra nhanh:** …" }),
      turnOut({ next_action: "explain_foundation", checkpoint_passed: true, assistant_text: "Đúng ý chính. Phần 2…\n\n**Kiểm tra nhanh:** Vì sao không nên tạo chỉ mục cho mọi cột?" }),
    ]);
    const s0 = newPath();
    const a = await runTurn(s0, { text: "Bắt đầu" }, { core: router, id: seqId });
    const b = await runTurn(a.session, { text: "Vì chỉ mục đã sắp xếp sẵn nên không phải đọc từng dòng." }, { core: router, id: seqId });
    expect(p.calls[1]!.user).toMatch(/Đặt checkpoint_passed = true/);
    const path = b.session.state.path!;
    expect(path.parts[0]!.status).toBe("done");
    expect(path.current).toBe(1);
    expect(path.parts[1]!.status).toBe("current");
    expect(path.stage).toBe("check");
  });

  it("CHƯA ĐẠT lần 1 → ở lại phần, tăng attempts; lần 2 vẫn chưa đạt → ghi 'nên ôn lại' và sang phần tiếp", async () => {
    const { p, router } = scripted([
      turnOut({ next_action: "explain_foundation", assistant_text: "…" }),
      turnOut({ next_action: "explain_foundation", checkpoint_passed: false, assistant_text: "Chưa khớp ở… **Kiểm tra nhanh:** …" }),
      turnOut({ next_action: "explain_foundation", checkpoint_passed: false, assistant_text: "Đáp án là… Sang phần 2…" }),
    ]);
    const a = await runTurn(newPath(), { text: "Bắt đầu" }, { core: router, id: seqId });
    const b = await runTurn(a.session, { text: "Em không chắc." }, { core: router, id: seqId });
    expect(b.session.state.path!.current).toBe(0);
    expect(b.session.state.path!.parts[0]!.attempts).toBe(1);
    const c = await runTurn(b.session, { text: "Chắc là do máy nhanh?" }, { core: router, id: seqId });
    expect(p.calls[2]!.user).toMatch(/lần thử thứ hai/);
    expect(c.session.state.path!.parts[0]!.status).toBe("review");
    expect(c.session.state.path!.current).toBe(1);
  });

  it("nút Bỏ qua → sang phần tiếp (gọi model giảng phần mới), không phải câu cố định", async () => {
    const { p, router } = scripted([turnOut({ next_action: "explain_foundation", assistant_text: "Phần 2…" })]);
    const r = await runTurn(newPath(), { text: "", intent: "skip" }, { core: router, id: seqId });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.user).toMatch(/bỏ qua Phần 1/);
    expect(r.session.state.path!.parts[0]!.status).toBe("skipped");
    expect(r.session.state.path!.current).toBe(1);
  });

  it("đi hết dàn ý → stage done, phase reflect, gợi ý tự kiểm tra / kết thúc", async () => {
    let s = newPath("review"); // 3 phần
    const outs = [turnOut({ next_action: "explain_foundation", assistant_text: "P1" })];
    for (let i = 0; i < 3; i++) outs.push(turnOut({ next_action: "explain_foundation", checkpoint_passed: true, assistant_text: `ok ${i}` }));
    const { p, router } = scripted(outs);
    s = (await runTurn(s, { text: "Bắt đầu" }, { core: router, id: seqId })).session;
    let last;
    for (let i = 0; i < 3; i++) { last = await runTurn(s, { text: `Trả lời ${i} khá đầy đủ ý chính.` }, { core: router, id: seqId }); s = last.session; }
    expect(p.calls[3]!.user).toMatch(/tóm tắt ngắn cả buổi học/);
    expect(s.state.path!.stage).toBe("done");
    expect(s.state.phase).toBe("reflect");
    expect(s.state.path!.parts.every((x) => x.status === "done")).toBe(true);
    expect(last!.result.quickReplies).toEqual(["try", "explain_more", "finish"]);
  });

  it("nút Gợi ý khi đang kiểm tra → policy thường + ngữ cảnh phần, không nêu thẳng đáp án", async () => {
    const { p, router } = scripted([turnOut({ next_action: "explain_foundation", assistant_text: "…" }), turnOut({ next_action: "give_hint", assistant_text: "Thử nghĩ về mục lục sách…" })]);
    const a = await runTurn(newPath(), { text: "Bắt đầu" }, { core: router, id: seqId });
    const b = await runTurn(a.session, { text: "", intent: "hint" }, { core: router, id: seqId });
    expect(p.calls[1]!.user).toMatch(/Ngữ cảnh: đang học Phần 1\/4/);
    expect(p.calls[1]!.user).toMatch(/KHÔNG nêu thẳng đáp án/);
    expect(b.session.state.path!.stage).toBe("check");
    expect(b.session.state.path!.current).toBe(0);
  });
});

describe("API: level khi tạo phiên", () => {
  it("POST /api/sessions với level → trả path; level sai → 400", async () => {
    const store = new MemoryStore();
    const provider = new ScriptedProvider([PLAN]);
    const app = createApp({
      store, authenticate: async () => USER,
      routers: (onCall) => ({ core: new ModelRouter(provider, null, { sleep: async () => {}, onCall }), light: null }),
    });
    const call = (body: unknown) => app.request("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { LIMIT_SESSIONS_PER_DAY: "10" });
    const r = await call({ mode: "explore", topic: "Chỉ mục", level: "beginner" });
    expect(r.status).toBe(201);
    const j = (await r.json()) as any;
    expect(j.path.parts).toHaveLength(3);
    expect(j.path.generatedBy).toBe("model");
    expect((await call({ mode: "explore", topic: "Chỉ mục", level: "expert" })).status).toBe(400);
    const plain = (await (await call({ mode: "explore", topic: "Chỉ mục" })).json()) as any;
    expect(plain.path).toBeNull();
  });
});

describe("API: hạn mức hôm nay", () => {
  it("GET /api/me/usage đếm phiên đã tạo hôm nay", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, authenticate: async () => USER });
    const env = { LIMIT_SESSIONS_PER_DAY: "3" };
    await app.request("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "reunderstand", topic: "3NF" }) }, env);
    const r = (await (await app.request("/api/me/usage", {}, env)).json()) as any;
    expect(r).toMatchObject({ sessionsToday: 1, sessionsPerDay: 3 });
    expect(new Date(r.resetAt).getUTCHours()).toBe(0);
  });
});

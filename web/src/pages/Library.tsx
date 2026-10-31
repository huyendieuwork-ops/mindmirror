import { useEffect, useState } from "react";
import { api, explain, type Connector } from "../lib/api";
import { UploadButton, kindLabel, useLibrary } from "../components/DocPicker";

const WARN: Record<string, string> = {
  suspicious_instructions: "Có đoạn chứa câu giống lệnh cho AI — MindMirror sẽ bỏ qua các lệnh đó",
  embedding_failed: "Chỉ tìm theo từ khoá (chưa tạo được tìm kiếm ngữ nghĩa)",
};
const warnText = (w: string) => (w.startsWith("scanned_pages:") ? `Trang ${w.split(":")[1]} chỉ có ảnh, chưa đọc được chữ` : WARN[w] ?? w);

export default function Library() {
  const lib = useLibrary();
  const [drag, setDrag] = useState(false);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl">Tài liệu của cậu</h1>
      <p className="mt-2 text-muted">Slide, giáo trình, ghi chú. MindMirror chỉ đọc những gì cậu đưa vào đây, và luôn ghi rõ trang khi trích dẫn.</p>

      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); lib.upload(e.dataTransfer.files); }}
        className={`mt-6 rounded-xl border-2 border-dashed px-6 py-8 text-center ${drag ? "border-mirror bg-mirror/5" : "border-line"}`}>
        <p className="font-serif text-lg">Kéo PDF, PPTX hoặc TXT vào đây</p>
        <p className="mt-1 text-sm text-muted">Chữ được đọc ngay trên máy cậu rồi mới gửi lên. <UploadButton onFiles={lib.upload} label="Chọn file" /></p>
        {lib.busy && <p className="mt-3 text-sm text-mirror">{lib.busy}</p>}
        {lib.error && <p className="mt-3 text-sm text-rust">{lib.error}</p>}
      </div>

      <ul className="mt-6 divide-y divide-line border-y border-line">
        {lib.docs.map((d) => (
          <li key={d.id} className="py-3 flex gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{d.title}</p>
              <p className="text-xs text-muted">{kindLabel(d)}, {d.pageCount} trang, {d.chunkCount} đoạn{d.embedded ? "" : ", tìm theo từ khoá"}</p>
              {d.warnings.map((w) => <p key={w} className="text-xs text-rust mt-0.5">{warnText(w)}</p>)}
            </div>
            <button className="text-sm text-muted hover:text-rust self-start" onClick={async () => { if (confirm(`Xoá “${d.title}” khỏi thư viện?`)) { await api.deleteDocument(d.id); lib.reload(); } }}>Xoá</button>
          </li>
        ))}
        {!lib.docs.length && <li className="py-6 text-sm text-muted">Chưa có tài liệu nào.</li>}
      </ul>

      <Connectors onImported={lib.reload} />
    </div>
  );
}

const PRESETS = [
  { v: "google_drive", l: "Google Drive" },
  { v: "notion", l: "Notion", url: "https://mcp.notion.com/mcp" },
  { v: "generic", l: "MCP khác" },
];

function Connectors({ onImported }: { onImported: () => void }) {
  const [items, setItems] = useState<Connector[]>([]);
  const [form, setForm] = useState({ name: "", url: "", preset: "google_drive", token: "" });
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => api.connectors().then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { reload(); }, []);

  async function add() {
    setBusy(true); setMsg(null);
    try {
      await api.addConnector({ name: form.name || PRESETS.find((p) => p.v === form.preset)!.l, url: form.url, preset: form.preset, token: form.token || undefined });
      setForm({ name: "", url: "", preset: "google_drive", token: "" }); setOpen(false); reload();
    } catch (e) { setMsg(explain(e)); } finally { setBusy(false); }
  }

  return (
    <section className="mt-14">
      <h2 className="font-serif text-2xl">Lấy từ Drive, Notion…</h2>
      <p className="mt-1 text-sm text-muted">Kết nối qua MCP. MindMirror chỉ dùng quyền đọc và chỉ nhập những file cậu chọn.</p>

      <ul className="mt-4 space-y-4">
        {items.map((c) => <ConnectorRow key={c.id} c={c} onImported={onImported} onRemoved={reload} />)}
      </ul>

      {open ? (
        <div className="mt-4 rounded-xl border border-line bg-sheet p-4 grid gap-3">
          <label className="grid gap-1 text-sm">Nguồn
            <select value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value, url: PRESETS.find((p) => p.v === e.target.value)?.url ?? form.url })}
              className="rounded-md border border-line bg-paper px-3 py-2">{PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm">Địa chỉ MCP server
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/mcp" className="rounded-md border border-line bg-paper px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">Token truy cập <span className="text-xs text-muted">(được mã hoá trước khi lưu)</span>
            <input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} className="rounded-md border border-line bg-paper px-3 py-2" />
          </label>
          {msg && <p className="text-sm text-rust">{msg}</p>}
          <div className="flex gap-3">
            <button disabled={!form.url || busy} onClick={add} className="rounded-lg bg-ink text-paper px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy ? "Đang kết nối…" : "Kết nối"}</button>
            <button onClick={() => setOpen(false)} className="text-sm text-muted">Huỷ</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-4 text-sm font-medium text-mirror underline underline-offset-4 decoration-line">Thêm kết nối</button>
      )}
    </section>
  );
}

function ConnectorRow({ c, onImported, onRemoved }: { c: Connector; onImported: () => void; onRemoved: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true); setMsg(null);
    try { const r = await api.connectorItems(c.id, q); setFound(r.items); if (!r.items.length) setMsg("Không thấy tài liệu nào khớp."); }
    catch (e) { setMsg(explain(e)); } finally { setBusy(false); }
  }
  async function importSel() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.importItems(c.id, found.filter((f) => sel.includes(f.id)));
      const ok = r.results.filter((x) => x.document).length;
      const bad = r.results.filter((x) => x.error);
      setMsg(`Đã nhập ${ok} tài liệu.${bad.length ? ` Không nhập được: ${bad.map((b) => b.item.title).join(", ")}.` : ""}`);
      setSel([]); onImported();
    } catch (e) { setMsg(explain(e)); } finally { setBusy(false); }
  }

  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium">{c.name} <span className="text-xs text-muted">{c.host}</span></p>
        <button className="text-sm text-muted hover:text-rust" onClick={async () => { await api.deleteConnector(c.id); onRemoved(); }}>Ngắt kết nối</button>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bài giảng, giáo trình…" className="flex-1 rounded-md border border-line bg-sheet px-3 py-2 text-sm" />
        <button disabled={busy} className="rounded-md border border-ink px-3 text-sm disabled:opacity-40">Tìm</button>
      </form>
      {found.length > 0 && (
        <>
          <ul className="mt-3 space-y-1">
            {found.map((f) => (
              <li key={f.id}><label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sel.includes(f.id)} onChange={() => setSel((s) => (s.includes(f.id) ? s.filter((x) => x !== f.id) : s.length < 10 ? [...s, f.id] : s))} />
                {f.title}
              </label></li>
            ))}
          </ul>
          <button disabled={!sel.length || busy} onClick={importSel} className="mt-3 rounded-lg bg-ink text-paper px-4 py-2 text-sm font-semibold disabled:opacity-40">
            {busy ? "Đang nhập…" : `Nhập ${sel.length || ""} tài liệu vào thư viện`}
          </button>
        </>
      )}
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </li>
  );
}

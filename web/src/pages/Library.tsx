import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, explain, type Connector } from "../lib/api";
import { UploadButton, kindLabel, useLibrary } from "../components/DocPicker";
import { Btn, Card, Icon, PageHeader } from "../components/ui";

const WARN: Record<string, string> = {
  suspicious_instructions: "Có đoạn chứa câu giống lệnh cho AI — MindMirror sẽ bỏ qua các lệnh đó",
  embedding_failed: "Chỉ tìm theo từ khoá (chưa tạo được tìm kiếm ngữ nghĩa)",
};
const warnText = (w: string) => (w.startsWith("scanned_pages:") ? `Trang ${w.split(":")[1]} chỉ có ảnh, chưa đọc được chữ` : WARN[w] ?? w);
const field = "w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm outline-none focus:border-mirror";

export default function Library() {
  const lib = useLibrary();
  const [drag, setDrag] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Thư viện tài liệu" subtitle="Slide, giáo trình, ghi chú. MindMirror chỉ đọc những gì bạn đưa vào đây, và luôn ghi rõ trang khi trích dẫn."
        actions={<Link to="/folders" className="inline-flex items-center gap-2 rounded-lg border border-line bg-sheet px-3.5 py-2 text-sm font-medium text-ink hover:border-mirror/60 hover:text-mirror"><Icon name="folder" /> Sắp xếp vào thư mục</Link>} />

      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); lib.upload(e.dataTransfer.files); }}
        className={`panel border-2 border-dashed px-6 py-8 text-center ${drag ? "!border-mirror bg-mist/50" : ""}`}>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-mist text-mirror"><Icon name="upload" className="h-6 w-6" /></span>
        <p className="mt-3 font-semibold text-ink">Kéo PDF, PPTX hoặc TXT vào đây</p>
        <p className="mt-1 text-sm text-muted">Chữ được đọc ngay trên máy bạn rồi mới gửi lên. <UploadButton onFiles={lib.upload} label="Chọn file" /></p>
        {lib.busy && <p className="mt-3 text-sm text-mirror">{lib.busy}</p>}
        {lib.error && <p className="mt-3 text-sm text-rust">{lib.error}</p>}
      </div>

      <Card title="Tài liệu đã tải lên" action={<span className="text-xs text-muted">{lib.docs.length} tài liệu</span>} bodyClass="px-5 pb-3">
        <ul className="divide-y divide-line">
          {lib.docs.map((d) => (
            <li key={d.id} className="flex gap-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-mist text-mirror"><Icon name="file" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{d.title}</p>
                <p className="text-xs text-muted">{kindLabel(d)} · {d.pageCount} trang · {d.chunkCount} đoạn{d.embedded ? "" : " · tìm theo từ khoá"}</p>
                {d.warnings.map((w) => <p key={w} className="mt-0.5 text-xs text-rust">{warnText(w)}</p>)}
              </div>
              <button className="self-start text-sm text-muted hover:text-rust" onClick={async () => { if (confirm(`Xoá “${d.title}” khỏi thư viện?`)) { await api.deleteDocument(d.id); lib.reload(); } }}>Xoá</button>
            </li>
          ))}
          {!lib.docs.length && <li className="py-6 text-sm text-muted">Chưa có tài liệu nào.</li>}
        </ul>
      </Card>

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
    <Card title="Lấy từ Drive, Notion…" subtitle="Kết nối qua MCP. MindMirror chỉ dùng quyền đọc và chỉ nhập những file bạn chọn."
      action={!open && <Btn variant="soft" onClick={() => setOpen(true)}><Icon name="link" /> Thêm kết nối</Btn>}>
      <ul className="space-y-4">
        {items.map((c) => <ConnectorRow key={c.id} c={c} onImported={onImported} onRemoved={reload} />)}
        {!items.length && !open && <li className="text-sm text-muted">Chưa có kết nối nào.</li>}
      </ul>
      {open && (
        <div className="mt-4 grid gap-3 rounded-xl bg-paper/70 p-4">
          <label className="grid gap-1 text-sm font-medium text-ink">Nguồn
            <select value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value, url: PRESETS.find((p) => p.v === e.target.value)?.url ?? form.url })} className={field}>
              {PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink">Địa chỉ MCP server
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/mcp" className={field} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink">Token truy cập <span className="text-xs font-normal text-muted">(được mã hoá trước khi lưu)</span>
            <input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} className={field} />
          </label>
          {msg && <p className="text-sm text-rust">{msg}</p>}
          <div className="flex gap-2">
            <Btn variant="primary" disabled={!form.url || busy} onClick={add}>{busy ? "Đang kết nối…" : "Kết nối"}</Btn>
            <Btn variant="ghost" onClick={() => setOpen(false)}>Huỷ</Btn>
          </div>
        </div>
      )}
    </Card>
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
        <p className="font-medium text-ink">{c.name} <span className="text-xs text-muted">{c.host}</span></p>
        <button className="text-sm text-muted hover:text-rust" onClick={async () => { await api.deleteConnector(c.id); onRemoved(); }}>Ngắt kết nối</button>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bài giảng, giáo trình…" className={`flex-1 ${field}`} />
        <Btn type="submit" disabled={busy}><Icon name="search" /> Tìm</Btn>
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
          <Btn variant="primary" className="mt-3" disabled={!sel.length || busy} onClick={importSel}>{busy ? "Đang nhập…" : `Nhập ${sel.length || ""} tài liệu vào thư viện`}</Btn>
        </>
      )}
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </li>
  );
}

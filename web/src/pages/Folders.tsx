import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, explain, type Folder, type LibraryDoc } from "../lib/api";
import { invalidate, useLearningData } from "../lib/data";
import { kindLabel, UploadButton, useLibrary } from "../components/DocPicker";
import KnowledgeGraph from "../components/KnowledgeGraph";
import FolderRoadmap from "../components/FolderRoadmap";
import { Btn, Card, Empty, FOLDER_COLORS, FOLDER_TONE, fmtDate, Icon, Modal, PageHeader, SelectBox } from "../components/ui";

const NONE = "none";

export default function Folders() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const lib = useLibrary();
  const { folders, reload, loading } = useLearningData();
  const [sel, setSel] = useState<string>(params.get("f") ?? "");
  const [sort, setSort] = useState<"new" | "name">("new");
  const [filter, setFilter] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [tab, setTab] = useState<"docs" | "path" | "graph">((new URLSearchParams(location.search).get("tab") as "path" | "graph" | null) ?? "docs");
  const [dialog, setDialog] = useState<null | { kind: "create" } | { kind: "rename"; folder: Folder } | { kind: "delete"; folder: Folder } | { kind: "move"; ids: string[] } | { kind: "deleteDocs"; ids: string[] }>(params.get("new") ? { kind: "create" } : null);
  const [error, setError] = useState<string | null>(null);

  const docs = lib.docs;
  useEffect(() => { if (sel || loading) return; if (folders.length) setSel([...folders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!.id); else if (docs.length) setSel(NONE); }, [folders, docs, sel, loading]);
  const prevSel = useRef(sel);
  useEffect(() => { if (prevSel.current && prevSel.current !== sel) { setChecked([]); setTab("docs"); } prevSel.current = sel; }, [sel]);
  const count = (id: string) => docs.filter((d) => (id === NONE ? !d.folderId : d.folderId === id)).length;
  const sortedFolders = useMemo(() => [...folders].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "vi") : b.createdAt.localeCompare(a.createdAt))), [folders, sort]);
  const current = folders.find((f) => f.id === sel) ?? null;
  const shown = docs.filter((d) => (sel === NONE ? !d.folderId : d.folderId === sel));
  const totalPages = docs.reduce((a, d) => a + d.pageCount, 0);
  const refresh = async () => { await Promise.all([lib.reload(), reload()]); invalidate(); };
  const choose = (id: string) => { setSel(id); setParams(id ? { f: id } : {}); };

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await refresh(); setDialog(null); } catch (e) { setError(explain(e)); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Thư mục" subtitle="Gom tài liệu và phiên học theo môn. Tài liệu không bắt buộc, nhưng giúp câu trả lời bám sát giáo trình và tạo được sơ đồ khái niệm."
        actions={<>
          <Btn variant="primary" onClick={() => setDialog({ kind: "create" })}><Icon name="plus" /> Tạo thư mục</Btn>
          <UploadButton variant="button" onFiles={(f) => lib.upload(f, sel && sel !== NONE ? sel : null)} />
          <SelectBox label="Sắp xếp" value={sort} onChange={setSort} className="w-44" options={[{ value: "new", label: "Sắp xếp: Mới nhất" }, { value: "name", label: "Sắp xếp: Tên A–Z" }]} />
        </>} />
      {(lib.busy || lib.error || error) && (
        <p className={`rounded-lg px-4 py-2.5 text-sm ${lib.busy ? "bg-mist text-mirror" : "bg-rust/10 text-rust"}`}>{lib.busy ?? lib.error ?? error}</p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_1fr]">
        <Card title="Danh sách thư mục" bodyClass="p-5 pt-4">
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Tìm thư mục…" className="w-full rounded-lg border border-line bg-sheet py-2 pl-9 pr-3 text-sm outline-none focus:border-mirror" />
          </div>
          <ul className="mt-3 space-y-1">
            {sortedFolders.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())).map((f) => (
              <li key={f.id}>
                <button onClick={() => choose(f.id)} className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${sel === f.id ? "bg-mist font-semibold text-ink before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-mirror" : "text-ink/80 hover:bg-mist/50"}`}>
                  <Icon name="folder" className={`h-5 w-5 ${(FOLDER_TONE[f.color] ?? FOLDER_TONE.blue).split(" ")[0]}`} />
                  <span className="flex-1 truncate text-left">{f.name}</span>
                  <span className="text-xs text-muted">{count(f.id)}</span>
                </button>
              </li>
            ))}
            {folders.length === 0 && <li className="px-3 pb-2 pt-3 text-sm text-muted">Chưa có thư mục nào.</li>}
            {count(NONE) > 0 && (
              <li className={folders.length ? "mt-2 border-t border-line pt-2" : ""}>
                <button onClick={() => choose(NONE)} className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${sel === NONE ? "bg-mist font-semibold text-ink before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-mirror" : "text-ink/80 hover:bg-mist/50"}`}>
                  <Icon name="file" className="h-5 w-5 text-muted" />
                  <span className="flex-1 truncate text-left">Tài liệu chưa xếp thư mục</span>
                  <span className="text-xs text-muted">{count(NONE)}</span>
                </button>
              </li>
            )}
          </ul>
        </Card>

        <section className="panel min-w-0">
          {!sel ? (
            <div className="p-5"><Empty icon="upload" title="Tải tài liệu đầu tiên" action={<div className="flex flex-wrap justify-center gap-2"><UploadButton variant="button" onFiles={(f) => lib.upload(f, null)} /><Btn onClick={() => setDialog({ kind: "create" })}><Icon name="plus" /> Tạo thư mục</Btn></div>}>Tải slide, giáo trình lên là dùng được ngay: MindMirror đối chiếu khi bạn học, tạo sơ đồ khái niệm và lộ trình học. Thư mục chỉ để gom theo môn — không bắt buộc.</Empty></div>
          ) : (
            <>
              <div className="flex flex-col gap-4 border-b border-line p-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-center gap-3">
                  <span className={`grid h-12 w-12 place-items-center rounded-full ${current ? FOLDER_TONE[current.color] ?? FOLDER_TONE.blue : "bg-paper text-muted"}`}><Icon name="folder" className="h-6 w-6" /></span>
                  <div><h2 className="text-lg font-bold text-ink">{current?.name ?? "Tài liệu chưa xếp thư mục"}</h2><p className="text-xs text-muted">{shown.length} tài liệu{!current && " · vẫn tạo được sơ đồ khái niệm và lộ trình, không cần thư mục"}</p>
                    {current && (current.goal
                      ? <p className="mt-1 max-w-xl text-sm text-ink"><span className="font-medium">Mục tiêu học:</span> {current.goal} <button className="text-mirror hover:underline" onClick={() => setDialog({ kind: "rename", folder: current })}>Sửa</button></p>
                      : <button className="mt-1 text-sm text-mirror hover:underline" onClick={() => setDialog({ kind: "rename", folder: current })}>+ Thêm mục tiêu học (không bắt buộc)</button>)}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 xl:items-end">
                  {current && (
                    <div className="flex flex-wrap gap-2">
                      <Btn onClick={() => setDialog({ kind: "rename", folder: current })}><Icon name="pencil" /> Chỉnh sửa</Btn>
                      <Btn disabled={!checked.length} onClick={() => setDialog({ kind: "move", ids: checked })}><Icon name="move" /> Di chuyển</Btn>
                      <Btn variant="danger" onClick={() => setDialog({ kind: "delete", folder: current })}><Icon name="trash" /> Xoá thư mục</Btn>
                    </div>
                  )}
                  {!current && (
                    <div className="flex flex-wrap gap-2">
                      <Btn disabled={!checked.length} onClick={() => setDialog({ kind: "move", ids: checked })}><Icon name="move" /> Chuyển vào thư mục</Btn>
                      {shown.length > 0 && <Btn variant="primary" onClick={() => nav("/?folder=unfiled")}><Icon name="arrowRight" /> Học với các tài liệu này</Btn>}
                    </div>
                  )}
                  {current && (
                    <div className="flex flex-wrap gap-2">
                      <Btn variant="primary" onClick={() => nav(`/?folder=${current.id}`)}><Icon name="arrowRight" /> Học trong thư mục này</Btn>
                    </div>
                  )}
                </div>
              </div>

              {(current || shown.length > 0) && (
                <div role="tablist" aria-label="Nội dung thư mục" className="flex gap-1 border-b border-line px-5">
                  {([["docs", `Tài liệu (${shown.length})`], ["path", "Lộ trình"], ["graph", "Sơ đồ khái niệm"]] as const).map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                      className={`-mb-px border-b-2 px-3 py-3 text-sm ${tab === k ? "border-mirror font-semibold text-mirror" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
                  ))}
                </div>
              )}
              {tab === "path" && (current || shown.length > 0) ? (
                <FolderRoadmap folder={current} docs={shown} onOpenGraph={() => setTab("graph")} />
              ) : tab === "graph" && (current || shown.length > 0) ? (
                <div className="p-5">
                  <p className="mb-4 rounded-xl bg-mist/50 px-4 py-3 text-sm text-ink/80">Sơ đồ dạng mind map được tạo từ các tài liệu {current ? "trong thư mục" : "bạn đã tải lên"}: AI đọc từng trang, sắp các ý chính từ chủ đề lớn tới ý con, và ghi quan hệ “cần biết trước” kèm câu trích nguyên văn làm căn cứ. Bấm vào sơ đồ để xem toàn màn hình.</p>
                  {shown.length ? <KnowledgeGraph docs={shown} marks={[]} title={current?.name ?? (shown.length === 1 ? shown[0]!.title : "Tài liệu chưa xếp thư mục")} /> : <Empty icon="upload" title="Chưa có tài liệu">Sơ đồ khái niệm cần ít nhất một tài liệu trong thư mục.</Empty>}
                </div>
              ) : shown.length === 0 ? (
                <div className="p-5"><Empty icon="upload" title="Thư mục chưa có tài liệu" action={<UploadButton variant="button" onFiles={(f) => lib.upload(f, current?.id ?? null)} />}>Tải lên PDF, slide PPTX hoặc ghi chú .txt/.md. Chữ được trích ngay trên trình duyệt.</Empty></div>
              ) : (
                <div className="overflow-x-auto p-3">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="bg-paper/70 text-left text-xs font-semibold text-muted">
                        <th className="w-10 rounded-l-lg px-3 py-3"><input type="checkbox" aria-label="Chọn tất cả" checked={checked.length === shown.length} onChange={(e) => setChecked(e.target.checked ? shown.map((d) => d.id) : [])} /></th>
                        <th className="px-3 py-3">Tên tài liệu</th><th className="px-3 py-3">Loại</th><th className="px-3 py-3">Ngày tải lên</th><th className="px-3 py-3">Số trang</th><th className="w-12 rounded-r-lg px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {shown.map((d) => <DocRow key={d.id} d={d} checked={checked.includes(d.id)} onCheck={(v) => setChecked((c) => (v ? [...c, d.id] : c.filter((x) => x !== d.id)))}
                        onMove={() => setDialog({ kind: "move", ids: [d.id] })} onDelete={() => setDialog({ kind: "deleteDocs", ids: [d.id] })} />)}
                    </tbody>
                  </table>
                  {checked.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 px-3 text-sm">
                      <span className="text-muted">Đã chọn {checked.length}</span>
                      <Btn onClick={() => setDialog({ kind: "move", ids: checked })}><Icon name="move" /> Di chuyển</Btn>
                      <Btn variant="danger" onClick={() => setDialog({ kind: "deleteDocs", ids: checked })}><Icon name="trash" /> Xóa</Btn>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
        <Card>
          <div className="flex items-center gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-mist text-mirror"><Icon name="database" className="h-5 w-5" /></span>
            <div className="flex-1">
              <div className="flex justify-between text-sm"><span className="font-semibold text-ink">Thư viện của bạn</span><span className="font-semibold text-ink">{docs.length} tài liệu</span></div>
              <p className="mt-1 text-xs text-muted">{totalPages} trang · {docs.filter((d) => d.embedded).length}/{docs.length} tài liệu hỗ trợ tìm theo ngữ nghĩa</p>
              <Link to="/library" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-mirror">Nhập từ Google Drive, Notion… <Icon name="arrowRight" className="h-3.5 w-3.5" /></Link>
            </div>
          </div>
        </Card>
        <div className="panel flex gap-4 bg-mist/40 p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sheet text-mirror"><Icon name="bulb" className="h-5 w-5" /></span>
          <div><p className="font-semibold text-ink">Tài liệu là tuỳ chọn</p><p className="mt-1 text-sm text-muted">Bạn có thể học ngay mà không cần tải tài liệu. Đặt mục tiêu học cho thư mục để AI chọn ví dụ và mức độ giải thích phù hợp.</p></div>
        </div>
      </div>

      <FolderDialog dialog={dialog} folders={folders} error={error} onClose={() => { setDialog(null); setError(null); if (params.get("new")) setParams({}); }}
        onCreate={(name, color, goal) => act(async () => { const f = await api.createFolder({ name, color, goal }); choose(f.id); })}
        onRename={(f, name, color, goal) => act(() => api.updateFolder(f.id, { name, color, goal }))}
        onDelete={(f) => act(async () => { await api.deleteFolder(f.id); choose(""); })}
        onMove={(ids, to) => act(async () => { for (const id of ids) await api.moveDocument(id, to); setChecked([]); })}
        onDeleteDocs={(ids) => act(async () => { for (const id of ids) await api.deleteDocument(id); setChecked([]); })} />
    </div>
  );
}

function DocRow({ d, checked, onCheck, onMove, onDelete }: { d: LibraryDoc; checked: boolean; onCheck: (v: boolean) => void; onMove: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const tone = d.kind === "pdf" ? "bg-rust/10 text-rust" : d.kind === "slides" ? "bg-[#FFF5E0] text-[#D8961E]" : "bg-mist text-mirror";
  return (
    <tr className="hover:bg-paper/50">
      <td className="px-3 py-3"><input type="checkbox" aria-label={`Chọn ${d.title}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} /></td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-[10px] font-bold ${tone}`}>{kindLabel(d).slice(0, 3).toUpperCase()}</span>
          <span className="min-w-0"><span className="block truncate font-medium text-ink">{d.title}</span>{!d.embedded && <span className="block text-[11px] text-muted">Chỉ tìm theo từ khoá</span>}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-muted">{kindLabel(d)}</td>
      <td className="px-3 py-3 text-muted">{fmtDate(d.createdAt)}</td>
      <td className="px-3 py-3 text-muted">{d.pageCount}</td>
      <td className="relative px-3 py-3">
        <button onClick={() => setMenu((m) => !m)} onBlur={() => setTimeout(() => setMenu(false), 150)} className="rounded-md px-2 py-1 text-muted hover:bg-mist" aria-label="Tuỳ chọn">⋮</button>
        {menu && (
          <div className="absolute right-3 top-10 z-10 w-44 overflow-hidden rounded-xl border border-line bg-sheet text-sm shadow-lg">
            <button onMouseDown={onMove} className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-mist/60"><Icon name="move" /> Di chuyển</button>
            <button onMouseDown={onDelete} className="flex w-full items-center gap-2 px-3 py-2.5 text-rust hover:bg-rust/10"><Icon name="trash" /> Xóa tài liệu</button>
          </div>
        )}
      </td>
    </tr>
  );
}

type DialogState = null | { kind: "create" } | { kind: "rename"; folder: Folder } | { kind: "delete"; folder: Folder } | { kind: "move"; ids: string[] } | { kind: "deleteDocs"; ids: string[] };

function FolderDialog({ dialog, folders, error, onClose, onCreate, onRename, onDelete, onMove, onDeleteDocs }: {
  dialog: DialogState; folders: Folder[]; error: string | null; onClose: () => void;
  onCreate: (name: string, color: string, goal: string | null) => void; onRename: (f: Folder, name: string, color: string, goal: string | null) => void; onDelete: (f: Folder) => void;
  onMove: (ids: string[], to: string | null) => void; onDeleteDocs: (ids: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [goal, setGoal] = useState("");
  const [to, setTo] = useState<string>(NONE);
  useEffect(() => {
    if (dialog?.kind === "rename") { setName(dialog.folder.name); setColor(dialog.folder.color); setGoal(dialog.folder.goal ?? ""); }
    else if (dialog?.kind === "create") { setName(""); setGoal(""); setColor(FOLDER_COLORS[folders.length % FOLDER_COLORS.length] ?? "blue"); }
    else if (dialog?.kind === "move") setTo(folders[0]?.id ?? NONE);
  }, [dialog, folders]);
  if (!dialog) return null;
  const err = error && <p className="mt-3 text-sm text-rust">{error}</p>;
  if (dialog.kind === "create" || dialog.kind === "rename") {
    const submit = () => name.trim() && (dialog.kind === "create" ? onCreate(name.trim(), color, goal.trim() || null) : onRename(dialog.folder, name.trim(), color, goal.trim() || null));
    return (
      <Modal open title={dialog.kind === "create" ? "Tạo thư mục" : "Chỉnh sửa thư mục"} onClose={onClose}
        footer={<><Btn onClick={onClose}>Huỷ</Btn><Btn variant="primary" disabled={!name.trim()} onClick={submit}>{dialog.kind === "create" ? "Tạo thư mục" : "Lưu"}</Btn></>}>
        <label className="text-sm font-medium text-ink">Tên thư mục
          <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Ví dụ: Cơ sở dữ liệu"
            className="mt-1.5 w-full rounded-lg border border-line bg-sheet px-3 py-2 font-normal outline-none focus:border-mirror" />
        </label>
        <label className="mt-4 block text-sm font-medium text-ink">Mục tiêu học <span className="font-normal text-muted">(không bắt buộc)</span>
          <textarea value={goal} maxLength={500} rows={3} onChange={(e) => setGoal(e.target.value)} placeholder="Ví dụ: Ôn thi cuối kỳ chương 4–6, ưu tiên ví dụ có lời giải"
            className="mt-1.5 w-full resize-none rounded-lg border border-line bg-sheet px-3 py-2 font-normal outline-none focus:border-mirror" />
          <span className="mt-1 block text-xs font-normal text-muted">AI dùng mục tiêu này để chọn ví dụ và mức độ giải thích trong các phiên của thư mục. {goal.length}/500</span>
        </label>
        <p className="mt-4 text-sm font-medium text-ink">Màu</p>
        <div className="mt-2 flex gap-2">
          {FOLDER_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c} className={`grid h-9 w-9 place-items-center rounded-lg ${FOLDER_TONE[c]} ${color === c ? "ring-2 ring-mirror ring-offset-2 ring-offset-sheet" : ""}`}><Icon name="folder" /></button>
          ))}
        </div>
        {err}
      </Modal>
    );
  }
  if (dialog.kind === "delete") {
    return (
      <Modal open title="Xoá thư mục" onClose={onClose} footer={<><Btn onClick={onClose}>Huỷ</Btn><Btn variant="danger" onClick={() => onDelete(dialog.folder)}>Xoá thư mục</Btn></>}>
        <p className="text-sm text-ink">Xoá thư mục <b>{dialog.folder.name}</b>? Tài liệu bên trong <b>không bị xóa</b> mà chuyển sang “Chưa xếp thư mục”.</p>{err}
      </Modal>
    );
  }
  if (dialog.kind === "move") {
    return (
      <Modal open title={`Di chuyển ${dialog.ids.length} tài liệu`} onClose={onClose} footer={<><Btn onClick={onClose}>Huỷ</Btn><Btn variant="primary" onClick={() => onMove(dialog.ids, to === NONE ? null : to)}>Di chuyển</Btn></>}>
        <SelectBox label="Chuyển tới" value={to} onChange={setTo} options={[...folders.map((f) => ({ value: f.id, label: f.name })), { value: NONE, label: "Chưa xếp thư mục" }]} />{err}
      </Modal>
    );
  }
  return (
    <Modal open title="Xóa tài liệu" onClose={onClose} footer={<><Btn onClick={onClose}>Huỷ</Btn><Btn variant="danger" onClick={() => onDeleteDocs(dialog.ids)}>Xóa vĩnh viễn</Btn></>}>
      <p className="text-sm text-ink">Xóa {dialog.ids.length} tài liệu khỏi thư viện? Thao tác này không hoàn tác được. Các phiên học cũ vẫn giữ trích dẫn đã lưu.</p>{err}
    </Modal>
  );
}

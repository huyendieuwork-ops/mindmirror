import { useEffect, useRef, useState } from "react";
import { api, explain, type LibraryDoc } from "../lib/api";
import { extractDocument } from "../lib/extract";
import { invalidate } from "../lib/data";
import { Icon } from "./ui";

/** Hook dùng chung: tải lên (trích chữ ở trình duyệt) + danh sách thư viện. */
export function useLibrary() {
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api.documents().then((r) => setDocs(r.items)).catch((e) => setError(explain(e)));
  useEffect(() => { reload(); }, []);

  /** folderId: nếu có, tài liệu mới được xếp luôn vào thư mục đó. */
  async function upload(files: FileList | File[], folderId?: string | null): Promise<LibraryDoc[]> {
    setError(null);
    const added: LibraryDoc[] = [];
    for (const f of Array.from(files)) {
      try {
        setBusy(`Đang đọc chữ trong “${f.name}”…`);
        const ex = await extractDocument(f);
        if (ex.pages.every((p) => p.text.trim().length < 20)) throw new Error("scan");
        setBusy(`Đang lưu “${f.name}” vào thư viện…`);
        const r = await api.uploadDocument({ title: ex.title, kind: ex.kind, pages: ex.pages });
        if (folderId) await api.moveDocument(r.document.id, folderId).catch(() => {});
        added.push({ ...r.document, folderId: folderId ?? r.document.folderId ?? null });
      } catch (e) {
        setError((e as Error).message === "scan" ? `“${f.name}” chỉ có ảnh scan, chưa đọc được chữ.` : (e as Error).message.startsWith("Định dạng") ? (e as Error).message : explain(e));
      }
    }
    setBusy(null);
    await reload();
    invalidate();
    return added;
  }
  return { docs, busy, error, upload, reload, setError };
}

export function UploadButton({ onFiles, label = "Tải tài liệu lên", variant = "link" }: { onFiles: (f: FileList) => void; label?: string; variant?: "link" | "button" }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept=".pdf,.pptx,.txt,.md,application/pdf" multiple hidden onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
      {variant === "button" ? (
        <button type="button" onClick={() => ref.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-line bg-sheet px-3.5 py-2 text-sm font-medium text-ink hover:border-mirror/60 hover:text-mirror">
          <Icon name="upload" /> {label}
        </button>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} className="shrink-0 whitespace-nowrap text-sm font-medium text-mirror hover:text-ink underline underline-offset-4 decoration-line">
          {label}
        </button>
      )}
    </>
  );
}

export function kindLabel(d: LibraryDoc) {
  return { pdf: "PDF", slides: "Slide", text: "Ghi chú", mcp: "Từ kết nối" }[d.kind] ?? d.kind;
}

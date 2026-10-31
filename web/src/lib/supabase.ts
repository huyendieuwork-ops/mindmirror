import { createClient, type Session as AuthSession } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Không cấu hình Supabase → chế độ dev (backend phải bật DEV_AUTH_BYPASS). */
export const supabase = url && key ? createClient(url, key) : null;
/** Bản demo (chưa có Supabase): mỗi trình duyệt một mã người dùng ngẫu nhiên, lưu lại để giữ lịch sử. */
function demoUser(): string {
  const fixed = import.meta.env.VITE_DEV_USER as string | undefined;
  if (fixed) return fixed;
  try {
    const k = "mindmirror-demo-user";
    const v = localStorage.getItem(k);
    if (v && /^[0-9a-f-]{36}$/i.test(v)) return v;
    const id = crypto.randomUUID();
    localStorage.setItem(k, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
export const DEV_USER = demoUser();

export async function signInWithGoogle() {
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
}

export async function signOut() {
  await supabase?.auth.signOut();
}

export type { AuthSession };

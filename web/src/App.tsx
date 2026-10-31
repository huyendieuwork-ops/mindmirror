import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase, type AuthSession } from "./lib/supabase";
import { applyTheme } from "./lib/theme";
import Layout, { type UserInfo } from "./components/Layout";
import Home from "./pages/Home";
import Learn from "./pages/Learn";
import SessionPage from "./pages/Session";
import Folders from "./pages/Folders";
import Reports from "./pages/Reports";
import Library from "./pages/Library";
import History from "./pages/History";
import SettingsPage from "./pages/Settings";
import Help from "./pages/Help";
import Login from "./pages/Login";

function userInfo(auth: AuthSession | null): UserInfo {
  const m = (auth?.user.user_metadata ?? {}) as Record<string, unknown>;
  const email = auth?.user.email ?? null;
  const name = (typeof m.full_name === "string" && m.full_name) || (typeof m.name === "string" && m.name) || (email ? email.split("@")[0]! : "Bạn");
  const avatar = (typeof m.avatar_url === "string" && m.avatar_url) || (typeof m.picture === "string" && m.picture) || null;
  return { name, email, avatar };
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    applyTheme();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setAuth(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (supabase && !auth) return <Login />;

  const user = userInfo(auth);
  return (
    <Layout user={user}>
      <Routes>
        <Route path="/" element={<Home name={user.name} />} />
        <Route path="/check" element={<Learn key="check" mode="reunderstand" />} />
        <Route path="/check/:id" element={<SessionPage />} />
        <Route path="/explore" element={<Learn key="explore" mode="explore" />} />
        <Route path="/explore/:id" element={<SessionPage />} />
        <Route path="/s/:id" element={<SessionPage />} />
        <Route path="/folders" element={<Folders />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/library" element={<Library />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<SettingsPage user={user} />} />
        <Route path="/help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

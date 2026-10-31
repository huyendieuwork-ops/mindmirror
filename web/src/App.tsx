import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase, type AuthSession } from "./lib/supabase";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import SessionPage from "./pages/Session";
import Library from "./pages/Library";
import History from "./pages/History";
import SettingsPage from "./pages/Settings";
import Login from "./pages/Login";

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setAuth(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (supabase && !auth) return <Login />;

  return (
    <Layout email={auth?.user.email ?? null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:id" element={<SessionPage />} />
        <Route path="/library" element={<Library />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

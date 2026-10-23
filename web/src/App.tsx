import { FormEvent, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, User } from "./api";
import { ListPage } from "./pages/ListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TagsPage } from "./pages/TagsPage";
import { TrashPage } from "./pages/TrashPage";

export function App() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });

  if (me.isLoading) {
    return <main className="page">Загрузка…</main>;
  }

  if (me.isError || !me.data) {
    return (
      <AuthScreen
        onDone={(user) => {
          qc.setQueryData(["me"], user);
        }}
      />
    );
  }

  return <Shell user={me.data} onLogout={() => qc.setQueryData(["me"], null)} />;
}

function AuthScreen({ onDone }: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user =
        mode === "login"
          ? await api.login(login, password)
          : await api.register(login, password);
      onDone(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page auth">
      <h1>Notetaker</h1>
      <p className="muted">Заметки, теги, корзина — M1.</p>
      <form onSubmit={submit} className="card">
        <label>
          Логин
          <input value={login} onChange={(e) => setLogin(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === "login" ? "Войти" : "Зарегистрироваться"}
        </button>
      </form>
      <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Создать аккаунт" : "Уже есть аккаунт"}
      </button>
    </main>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
      onLogout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page shell">
      <header className="shell-header">
        <h1>Notetaker</h1>
        <div className="shell-user">
          <span className="muted">{user.login}</span>{" "}
          <button type="button" onClick={logout} disabled={busy}>
            Выйти
          </button>
        </div>
      </header>
      <nav className="app-nav">
        <NavLink to="/list">Список</NavLink>
        <NavLink to="/tags">Теги</NavLink>
        <NavLink to="/trash">Корзина</NavLink>
        <NavLink to="/settings">Настройки</NavLink>
        <span className="muted small nav-soon">Календарь · M2</span>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/list" replace />} />
        <Route path="/list" element={<ListPage user={user} />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/trash" element={<TrashPage user={user} />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/list" replace />} />
      </Routes>
    </main>
  );
}

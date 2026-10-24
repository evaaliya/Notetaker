import { FormEvent, useCallback, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, RealtimeEvent, User } from "./api";
import { ToastItem, ToastStack } from "./components/ToastStack";
import { useRealtime } from "./hooks/useRealtime";
import { CalendarPage } from "./pages/CalendarPage";
import { ListPage } from "./pages/ListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TagsPage } from "./pages/TagsPage";
import { TrashPage } from "./pages/TrashPage";
import { UpcomingPage } from "./pages/UpcomingPage";

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
      <p className="muted">Заметки, календарь, ближайшее.</p>
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);

  const unseen = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.listNotifications(true),
  });

  const onNotificationNew = useCallback((ev: RealtimeEvent) => {
    const id = ev.ids?.[0];
    if (!id) return;
    setToasts((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { id, title: ev.title ?? "Напоминание", body: ev.body ?? "" }];
    });
  }, []);

  const onNotificationSeen = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useRealtime(true, { onNotificationNew, onNotificationSeen });

  async function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    try {
      await api.markNotificationSeen(id);
    } catch {
      /* ignore — toast already hidden locally */
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
      onLogout();
    } finally {
      setBusy(false);
    }
  }

  const unseenCount = unseen.data?.length ?? 0;

  return (
    <main className="page shell">
      <header className="shell-header">
        <h1>Notetaker</h1>
        <div className="shell-user">
          <div className="bell-wrap">
            <button
              type="button"
              className="secondary"
              data-testid="notif-bell"
              aria-label="Уведомления"
              onClick={() => setInboxOpen((v) => !v)}
            >
              Увед.{unseenCount > 0 ? ` ${unseenCount}` : ""}
            </button>
            {inboxOpen && (
              <div className="inbox card" data-testid="notif-inbox">
                <h4>Непрочитанные</h4>
                {unseenCount === 0 && <p className="muted small">Пусто</p>}
                <ul className="note-list">
                  {(unseen.data ?? []).map((n) => (
                    <li key={n.id} className="note-row">
                      <div className="note-main">
                        <strong>{n.title}</strong>
                        <span className="muted small">{n.body}</span>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => dismissToast(n.id)}
                      >
                        Прочитано
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <span className="muted">{user.login}</span>{" "}
          <button type="button" onClick={logout} disabled={busy}>
            Выйти
          </button>
        </div>
      </header>
      <nav className="app-nav">
        <NavLink to="/calendar">Календарь</NavLink>
        <NavLink to="/upcoming">Ближайшее</NavLink>
        <NavLink to="/list">Список</NavLink>
        <NavLink to="/tags">Теги</NavLink>
        <NavLink to="/trash">Корзина</NavLink>
        <NavLink to="/settings">Настройки</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/calendar" replace />} />
        <Route path="/calendar" element={<CalendarPage user={user} />} />
        <Route path="/upcoming" element={<UpcomingPage user={user} />} />
        <Route path="/list" element={<ListPage user={user} />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/trash" element={<TrashPage user={user} />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import logoNt from "./assets/logo-nt.jpg";
import { api, RealtimeEvent, User } from "./api";
import { AppSidebar } from "./components/AppSidebar";
import { MobileNav } from "./components/MobileNav";
import { NotificationsPopover } from "./components/NotificationsPopover";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { ToastItem, ToastStack } from "./components/ToastStack";
import { browserTimeZone } from "./components/TimezonePicker";
import { QuickAddProvider, useQuickAdd } from "./hooks/useQuickAdd";
import { useRealtime } from "./hooks/useRealtime";
import { loadUiPrefs } from "./lib/uiPrefs";
import { playNotifyChime, unlockNotifyAudio } from "./lib/notifySound";
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

  return (
    <QuickAddProvider>
      <Shell user={me.data} onLogout={() => qc.setQueryData(["me"], null)} />
    </QuickAddProvider>
  );
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
          : await api.register(login, password, browserTimeZone());
      onDone(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page auth">
      <div className="auth-brand">
        <img className="brand-mark" src={logoNt} alt="" width={32} height={32} />
        <h1>Notetaker</h1>
      </div>
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
  const [bellShake, setBellShake] = useState(false);

  useEffect(() => {
    const unlock = () => unlockNotifyAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

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
    const prefs = loadUiPrefs();
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefs.bellAnim && !reduceMotion) {
      setBellShake(true);
      window.setTimeout(() => setBellShake(false), 800);
    }
    if (prefs.sound) playNotifyChime();
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
  const quickAdd = useQuickAdd();

  const userEmail = user.email?.trim() || user.login;

  return (
    <div className="app-frame">
      <AppSidebar
        unseenCount={unseenCount}
        inboxOpen={inboxOpen}
        onToggleInbox={() => setInboxOpen((v) => !v)}
        userEmail={userEmail}
        onLogout={logout}
        logoutBusy={busy}
        bellShake={bellShake}
      />
      <main className="app-main">
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
        <NotificationsPopover
          open={inboxOpen}
          onClose={() => setInboxOpen(false)}
          onMarkSeen={dismissToast}
        />
      </main>
      <MobileNav />
      <button
        type="button"
        className="mobile-fab"
        data-testid="mobile-new-note"
        aria-label="Новая заметка"
        onClick={() => quickAdd.show()}
      >
        Новая заметка
      </button>
      <QuickAddSheet user={user} open={quickAdd.open} onClose={quickAdd.hide} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

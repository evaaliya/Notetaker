import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, User } from "./api";

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
      <p className="muted">M0: вход и сессия. Остальные экраны — с M1.</p>
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
    <main className="page">
      <header className="shell-header">
        <h1>Notetaker</h1>
        <div>
          <span className="muted">{user.login}</span>{" "}
          <button type="button" onClick={logout} disabled={busy}>
            Выйти
          </button>
        </div>
      </header>
      <p>Скелет готов. Календарь, список и напоминания появятся на следующих этапах.</p>
      <ul className="nav-stub">
        <li>Календарь — M2</li>
        <li>Список — M1</li>
        <li>Ближайшее — M2</li>
        <li>Корзина — M1</li>
        <li>Теги — M1</li>
        <li>Настройки — M1</li>
      </ul>
    </main>
  );
}

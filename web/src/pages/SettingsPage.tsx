import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

const COMMON_TZ = [
  "UTC",
  "Asia/Bishkek",
  "Europe/Moscow",
  "Europe/Berlin",
  "America/New_York",
];

export function SettingsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [email, setEmail] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.patchMe({
        email: (email ?? me.data?.email ?? "") || null,
        timezone: timezone ?? me.data?.timezone ?? "UTC",
      }),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      setMsg("Сохранено");
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (me.isLoading || !me.data) return <p className="muted">Загрузка…</p>;

  const emailValue = email ?? me.data.email ?? "";
  const tzValue = timezone ?? me.data.timezone;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    save.mutate();
  }

  return (
    <section>
      <h2>Настройки</h2>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            data-testid="settings-email"
            value={emailValue}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="для напоминаний"
          />
        </label>
        <label>
          Часовой пояс (IANA)
          <input
            list="tz-list"
            value={tzValue}
            onChange={(e) => setTimezone(e.target.value)}
            required
          />
          <datalist id="tz-list">
            {COMMON_TZ.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
        {msg && <p className={save.isError ? "error" : "muted"}>{msg}</p>}
        <button type="submit" disabled={save.isPending}>
          Сохранить
        </button>
      </form>
    </section>
  );
}

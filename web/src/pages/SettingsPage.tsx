import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Switch } from "../components/Switch";
import { TimezonePicker } from "../components/TimezonePicker";
import {
  loadUiPrefs,
  saveUiPrefs,
  type UiPrefs,
} from "../lib/uiPrefs";

export function SettingsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [email, setEmail] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadUiPrefs());

  useEffect(() => {
    saveUiPrefs(prefs);
  }, [prefs]);

  const save = useMutation({
    mutationFn: () =>
      api.patchMe({
        email: (email ?? me.data?.email ?? "") || null,
        timezone: timezone ?? me.data?.timezone ?? "UTC",
      }),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
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
    <section className="settings-page">
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <div className="mut">Почта, пояс и уведомления на этом устройстве</div>
        </div>
      </div>
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
          <TimezonePicker value={tzValue} onChange={setTimezone} />
        </label>
        <div className="settings-row">
          <div>
            <strong>Звук уведомления</strong>
            <div className="muted small">Короткий сигнал при reminder (localStorage)</div>
          </div>
          <Switch
            label="Звук уведомления"
            checked={prefs.sound}
            onChange={(sound) => setPrefs((p) => ({ ...p, sound }))}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Анимация колокольчика</strong>
            <div className="muted small">Покачивание при новом уведомлении</div>
          </div>
          <Switch
            label="Анимация колокольчика"
            checked={prefs.bellAnim}
            onChange={(bellAnim) => setPrefs((p) => ({ ...p, bellAnim }))}
          />
        </div>
        {msg && <p className={save.isError ? "error" : "muted"}>{msg}</p>}
        <button type="submit" className="btn-accent" disabled={save.isPending}>
          Сохранить
        </button>
        <p className="muted small">
          <Link to="/tags">Управлять метками</Link>
        </p>
      </form>
    </section>
  );
}

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ApiError, api, Tag, User } from "../api";
import { AttachmentClipIcon } from "../components/AttachmentsPanel";
import { NoteIllustration } from "../components/NoteIllustration";
import { OverflowMenu } from "../components/OverflowMenu";
import { Switch } from "../components/Switch";
import { TagPill } from "../components/TagPill";
import {
  formatInZone,
  localDateEndToUtcIso,
  localDateStartToUtcIso,
} from "../format";
import { enqueueDelete } from "../lib/mutationOutbox";
import { observeElementSize } from "../lib/observeElementSize";
import { recordRender } from "../lib/renderProbe";

type Filters = {
  q: string;
  status: string;
  tagId: string;
  /** Local yyyy-MM-dd in user timezone; empty = no bound. */
  fromDate: string;
  toDate: string;
  sort: "starts_at" | "updated_at";
  dir: "asc" | "desc";
};

export function ListPage({ user }: { user: User }) {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  useLayoutEffect(() => {
    recordRender("list", performance.now() - t0);
  });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tagFromUrl = searchParams.get("tag") ?? "";
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [filters, setFilters] = useState<Filters>({
    q: "",
    status: "",
    tagId: tagFromUrl,
    fromDate: "",
    toDate: "",
    sort: "starts_at",
    dir: "asc",
  });
  const [draft, setDraft] = useState<Filters>(filters);
  const [periodError, setPeriodError] = useState<string | null>(null);

  useEffect(() => {
    if (tagFromUrl === filters.tagId) return;
    const next = { ...filters, tagId: tagFromUrl };
    setFilters(next);
    setDraft(next);
  }, [tagFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const listQuery = useInfiniteQuery({
    queryKey: ["notes", filters, user.timezone],
    queryFn: ({ pageParam }) => {
      let from: string | undefined;
      let to: string | undefined;
      if (filters.fromDate) {
        from = localDateStartToUtcIso(filters.fromDate, user.timezone);
      }
      if (filters.toDate) {
        to = localDateEndToUtcIso(filters.toDate, user.timezone);
      }
      return api.listNotes({
        q: filters.q || undefined,
        status: filters.status || undefined,
        tags: filters.tagId ? [filters.tagId] : undefined,
        from,
        to,
        sort: filters.sort,
        dir: filters.dir,
        cursor: pageParam,
        limit: 40,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const notes = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [listQuery.data],
  );
  const tagList = tags.data ?? [];

  // ≤900: actions wrap under the row → taller items (D-103).
  const [narrowRows, setNarrowRows] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setNarrowRows(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (narrowRows ? 168 : 112),
    overscan: 8,
    // offsetHeight: stable for absolute rows (Safari); was disabled on Firefox → only estimate (D-103).
    measureElement: (el) => (el as HTMLElement).offsetHeight,
  });

  // Remeasure when data/layout changes (tags load, breakpoint). Avoid depending on
  // `virtualizer` identity — measure() can churn and freeze the page (D-103).
  useLayoutEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable measure API
  }, [notes.length, tagList.length, narrowRows, listQuery.dataUpdatedAt]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    // rAF + ≥1px + ignore self (virtualizer.measure) — D-089/D-103/M23.
    return observeElementSize(el, () => {
      virtualizer.measure();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      setPeriodError("Дата «с» не может быть позже даты «по»");
      return;
    }
    setPeriodError(null);
    setFilters(draft);
  }

  /** Reset search/tags/status/period; keep sort+dir (M25). */
  function resetFilters() {
    setPeriodError(null);
    const next: Filters = {
      ...draft,
      q: "",
      status: "",
      tagId: "",
      fromDate: "",
      toDate: "",
      sort: filters.sort,
      dir: filters.dir,
    };
    setDraft(next);
    setFilters(next);
  }

  const remove = useMutation({
    mutationFn: async (id: string) => {
      try {
        return await api.deleteNote(id);
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 0 || err.code === "network" || err.code === "timeout")
        ) {
          await enqueueDelete(id);
          return null;
        }
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (n: { id: string; status: string }) =>
      n.status === "active" ? api.deactivateNote(n.id) : api.activateNote(n.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  function openCreate() {
    // Same Apple Notes editor on desktop and mobile (D-130); no QuickAddSheet.
    navigate("/notes/new");
  }

  return (
    <section className="list-page">
      <div className="page-head">
        <div>
          <h1>Список</h1>
          <div className="mut">Поиск и фильтры на сервере</div>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn-accent"
            data-testid="new-note"
            onClick={openCreate}
          >
            Новая заметка
          </button>
        </div>
      </div>

      <form
        className="list-toolbar-bar card"
        data-testid="list-toolbar"
        onSubmit={applyFilters}
      >
        <div className="list-toolbar-search">
          <input
            className="search-input"
            placeholder="Поиск"
            aria-label="Поиск"
            data-testid="list-search"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setFilters(draft);
              }
            }}
          />
        </div>
        <div className="list-toolbar-filters" data-testid="list-toolbar-filters">
          <select
            aria-label="Теги"
            data-testid="list-tag-filter"
            value={draft.tagId}
            onChange={(e) => setDraft({ ...draft, tagId: e.target.value })}
          >
            <option value="">Все теги</option>
            {tagList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Статус"
            data-testid="list-status-filter"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">Все статусы</option>
            <option value="active">активные</option>
            <option value="inactive">неактивные</option>
          </select>
          <label className="list-period-field">
            <span className="muted small">С</span>
            <input
              type="date"
              aria-label="Период с"
              data-testid="list-from"
              value={draft.fromDate}
              onChange={(e) => {
                setPeriodError(null);
                setDraft({ ...draft, fromDate: e.target.value });
              }}
            />
          </label>
          <label className="list-period-field">
            <span className="muted small">По</span>
            <input
              type="date"
              aria-label="Период по"
              data-testid="list-to"
              value={draft.toDate}
              onChange={(e) => {
                setPeriodError(null);
                setDraft({ ...draft, toDate: e.target.value });
              }}
            />
          </label>
          <select
            aria-label="Сортировка"
            data-testid="list-sort-filter"
            value={`${draft.sort}:${draft.dir}`}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(":") as [
                Filters["sort"],
                Filters["dir"],
              ];
              setDraft({ ...draft, sort, dir });
            }}
          >
            <option value="starts_at:asc">дата ↑</option>
            <option value="starts_at:desc">дата ↓</option>
            <option value="updated_at:desc">изменены ↓</option>
            <option value="updated_at:asc">изменены ↑</option>
          </select>
          <button type="submit" className="btn-accent" data-testid="list-apply">
            Применить
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="list-reset"
            onClick={resetFilters}
          >
            Сбросить
          </button>
        </div>
        {periodError && (
          <p className="error list-period-error" data-testid="list-period-error" role="alert">
            {periodError}
          </p>
        )}
      </form>

      <div
        ref={parentRef}
        className="virtual-list"
        onScroll={() => {
          const el = parentRef.current;
          if (!el || !listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
            listQuery.fetchNextPage();
          }
        }}
      >
        {listQuery.isLoading && <p className="muted">Загрузка…</p>}
        {!listQuery.isLoading && notes.length === 0 && (
          <p className="muted">Нет заметок по фильтру.</p>
        )}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const n = notes[row.index];
            const noteTags = n.tag_ids
              .map((tid) => tagList.find((t) => t.id === tid))
              .filter(Boolean) as Tag[];
            const first = noteTags[0];
            const offsets =
              n.reminder_offsets?.length > 0
                ? `напоминание за ${n.reminder_offsets.join("/")} мин`
                : null;
            return (
              <div
                key={n.id}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="note-row virtual-row list-row"
                data-testid="list-note-row"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <NoteIllustration
                  title={n.title}
                  body={n.body}
                  tagName={first?.name}
                  tagColor={first?.color}
                  size={44}
                />
                <button
                  type="button"
                  className="note-main linkish"
                  data-testid="list-note-main"
                  onClick={() => navigate(`/notes/${n.id}`)}
                >
                  <strong className="list-note-title" data-testid="list-note-title">
                    <span className="list-note-title-text">
                      {n.title || "Без названия"}
                    </span>
                    {n.has_attachments ? <AttachmentClipIcon /> : null}
                  </strong>
                  {n.role === "editor" && n.owner_login ? (
                    <span className="muted small" data-testid="shared-note-badge">
                      Общая · владелец: {n.owner_login}
                    </span>
                  ) : null}
                  {n.body ? (
                    <span
                      className="muted small list-body-preview"
                      data-testid="list-note-preview"
                    >
                      {n.body}
                    </span>
                  ) : null}
                  <span
                    className="muted small list-note-meta"
                    data-testid="note-starts-display"
                    data-note-id={n.id}
                  >
                    {formatInZone(n.starts_at, user.timezone)}
                    {n.rec_freq ? " · повтор" : ""}
                    {offsets ? ` · ${offsets}` : ""}
                  </span>
                  {noteTags.length > 0 && (
                    <span className="list-tags">
                      {noteTags.map((t) => (
                        <TagPill key={t.id} name={t.name} color={t.color} />
                      ))}
                    </span>
                  )}
                </button>
                <div className="note-actions">
                  {n.role !== "editor" ? (
                    <>
                      <div className="note-actions-wide">
                        <Switch
                          label={n.status === "active" ? "Активна" : "Неактивна"}
                          checked={n.status === "active"}
                          onChange={() => toggle.mutate(n)}
                        />
                        <button
                          type="button"
                          className="link"
                          onClick={() => remove.mutate(n.id)}
                        >
                          В корзину
                        </button>
                      </div>
                      <div className="note-actions-compact">
                        <OverflowMenu
                          label="Действия"
                          items={[
                            {
                              id: "toggle",
                              label:
                                n.status === "active"
                                  ? "Сделать неактивной"
                                  : "Сделать активной",
                              onSelect: () => toggle.mutate(n),
                            },
                            {
                              id: "trash",
                              label: "В корзину",
                              danger: true,
                              onSelect: () => remove.mutate(n.id),
                            },
                          ]}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {listQuery.isFetchingNextPage && <p className="muted small">Ещё…</p>}
      </div>
    </section>
  );
}

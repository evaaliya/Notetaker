import { useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, Tag } from "../api";
import { formatInZone } from "../format";
import { NoteIllustration } from "./NoteIllustration";
import { TagPill } from "./TagPill";

type Props = {
  timeZone: string;
};

export function NotesRail({ timeZone }: Props) {
  const { id: selectedId } = useParams();
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });

  const listQuery = useInfiniteQuery({
    queryKey: ["notes", "rail", appliedQ],
    queryFn: ({ pageParam }) =>
      api.listNotes({
        q: appliedQ || undefined,
        sort: "starts_at",
        dir: "asc",
        cursor: pageParam,
        limit: 40,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const notes = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [listQuery.data],
  );
  const tagList = tags.data ?? [];

  return (
    <aside className="notes-rail" data-testid="notes-rail" aria-label="Список заметок">
      <div className="notes-rail-head">
        <input
          className="search-input notes-rail-search"
          placeholder="Поиск"
          aria-label="Поиск в списке заметок"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setAppliedQ(q);
            }
          }}
        />
      </div>
      <div
        className="notes-rail-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
            listQuery.fetchNextPage();
          }
        }}
      >
        {notes.map((n) => {
          const noteTags = n.tag_ids
            .map((tid) => tagList.find((t) => t.id === tid))
            .filter(Boolean) as Tag[];
          const first = noteTags[0];
          const selected = selectedId === n.id;
          return (
            <NavLink
              key={n.id}
              to={`/notes/${n.id}`}
              className={`notes-rail-row${selected ? " is-selected" : ""}`}
              data-testid="notes-rail-row"
              data-note-id={n.id}
            >
              <NoteIllustration
                title={n.title}
                body={n.body}
                tagName={first?.name}
                tagColor={first?.color}
                size={32}
              />
              <span className="notes-rail-main">
                <strong className="notes-rail-title">{n.title || "Без названия"}</strong>
                <span className="muted small">{formatInZone(n.starts_at, timeZone)}</span>
                {noteTags.length > 0 && (
                  <span className="list-tags">
                    {noteTags.slice(0, 2).map((t) => (
                      <TagPill key={t.id} name={t.name} color={t.color} />
                    ))}
                  </span>
                )}
              </span>
            </NavLink>
          );
        })}
        {listQuery.isLoading && <p className="muted small">Загрузка…</p>}
        {!listQuery.isLoading && notes.length === 0 && (
          <p className="muted small">Нет заметок</p>
        )}
      </div>
    </aside>
  );
}

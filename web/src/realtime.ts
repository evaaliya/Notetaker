import { QueryClient } from "@tanstack/react-query";
import { RealtimeEvent } from "./api";

export function invalidateForEvent(qc: QueryClient, ev: RealtimeEvent): void {
  switch (ev.type) {
    case "note.changed":
    case "note.deleted":
    case "note.restored":
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
      for (const id of ev.ids ?? []) {
        qc.invalidateQueries({ queryKey: ["note", id] });
      }
      break;
    case "tag.changed":
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      break;
    case "settings.changed":
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      break;
    case "notification.new":
    case "notification.seen":
      qc.invalidateQueries({ queryKey: ["notifications"] });
      break;
    default:
      break;
  }
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

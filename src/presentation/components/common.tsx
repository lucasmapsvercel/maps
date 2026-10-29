import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Notice as NoticeValue } from "../use-portal";

export function Notice({ notice }: { notice: NoticeValue | null }) {
  return notice && <div className={`notice${notice.error ? " notice-error" : ""}`} role={notice.error ? "alert" : "status"}>
    <span aria-hidden="true">{notice.error ? "!" : "ⓘ"}</span><span>{notice.message}</span>
  </div>;
}

export function Modal({ title, onClose, children, detail = false }: {
  title: string; onClose: () => void; children: ReactNode; detail?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`modal${detail ? " detail-modal" : ""}`} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-content">{children}</div>
  </dialog>;
}

export function Heading({ title, subtitle, onNewSearch }: {
  title: string; subtitle: string; onNewSearch: () => void;
}) {
  return <div className="page-heading">
    <div><span className="eyebrow">PESQUISA LOCAL</span><h1>{title}</h1><p className="heading-subtitle">{subtitle}</p></div>
    <div className="heading-actions"><button className="button button-primary" onClick={onNewSearch}>＋ Nova busca</button></div>
  </div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon" aria-hidden="true">⌕</span>
    <strong>{title}</strong>{children}</div>;
}

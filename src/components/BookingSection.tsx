import { useId, useState } from "react";
import { RESERVATION_STATUSES, type Attachment, type ReservationStatus } from "../../shared/schema";
import { openAttachment, prepareFile, type PendingFile } from "../data/bookings";
import { STATUS_LABEL } from "../data/labels";
import { FileIcon } from "./icons";
import styles from "./BookingSection.module.css";

export type BookingDraft = {
  enabled: boolean;
  time: string;
  party: string;
  code: string;
  url: string;
  status: ReservationStatus;
  added: PendingFile[];
  removed: Attachment[];
};

type Props = {
  draft: BookingDraft;
  existing: Attachment[];
  onChange: (next: BookingDraft) => void;
};

export function BookingSection({ draft, existing, onChange }: Props) {
  const ids = useId();
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BookingDraft>) => {
    onChange({ ...draft, ...patch });
  };
  const kept = existing.filter((a) => !draft.removed.some((r) => r.id === a.id));

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setFileError(null);
    const added: PendingFile[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await prepareFile(file));
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "無法讀取這個檔案。");
      }
    }
    setBusy(false);
    onChange({ ...draft, added: [...draft.added, ...added] });
  }

  return (
    <section className={`${styles.section} card glass`} aria-label="訂位資訊">
      <div className={styles.toggle}>
        <label htmlFor={`${ids}-on`}>
          有訂位或票券
        </label>
        <input
          id={`${ids}-on`}
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => {
            set({ enabled: e.target.checked });
          }}
        />
      </div>

      {draft.enabled && (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${ids}-time`} className="field-label">
                訂位時間
              </label>
              <input
                id={`${ids}-time`}
                type="time"
                className="input"
                value={draft.time}
                onChange={(e) => {
                  set({ time: e.target.value });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor={`${ids}-party`} className="field-label">
                人數
              </label>
              <input
                id={`${ids}-party`}
                type="number"
                inputMode="numeric"
                min={1}
                className="input"
                value={draft.party}
                onChange={(e) => {
                  set({ party: e.target.value });
                }}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-code`} className="field-label">
              訂位代號
            </label>
            <input
              id={`${ids}-code`}
              className="input"
              maxLength={200}
              placeholder="例如 KY-2048"
              value={draft.code}
              onChange={(e) => {
                set({ code: e.target.value });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-url`} className="field-label">
              確認連結
            </label>
            <input
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              className="input"
              maxLength={2000}
              placeholder="貼上確認信或訂位頁面的網址"
              value={draft.url}
              onChange={(e) => {
                set({ url: e.target.value });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-status`} className="field-label">
              狀態
            </label>
            <select
              id={`${ids}-status`}
              className="select"
              value={draft.status}
              onChange={(e) => {
                set({ status: e.target.value as ReservationStatus });
              }}
            >
              {RESERVATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {(kept.length > 0 || draft.added.length > 0) && (
            <ul className={styles.files} aria-label="附件">
              {kept.map((a) => (
                <li key={a.id}>
                  <button type="button" className={styles.fileName} onClick={() => void openAttachment(a)}>
                    <FileIcon size={18} />
                    {a.filename}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    aria-label={`移除 ${a.filename}`}
                    onClick={() => {
                      set({ removed: [...draft.removed, a] });
                    }}
                  >
                    移除
                  </button>
                </li>
              ))}
              {draft.added.map((f) => (
                <li key={f.id}>
                  <span className={styles.fileName}>
                    <FileIcon size={18} />
                    {f.filename}
                  </span>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    aria-label={`移除 ${f.filename}`}
                    onClick={() => {
                      set({ added: draft.added.filter((x) => x.id !== f.id) });
                    }}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className={styles.attach}>
            <input
              type="file"
              className="visually-hidden"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {busy ? "處理中…" : "附上截圖或 PDF"}
          </label>
          {fileError && (
            <p className="error-text" role="alert">
              {fileError}
            </p>
          )}
        </>
      )}
    </section>
  );
}

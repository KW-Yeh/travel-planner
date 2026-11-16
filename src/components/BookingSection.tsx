import { useId, useState } from "react";
import { RESERVATION_STATUSES, type Attachment, type ReservationStatus } from "../../shared/schema";
import { openAttachment, prepareFile, type AttachmentType, type PendingFile } from "../data/bookings";
import { STATUS_LABEL } from "../data/labels";
import { FieldError, Segmented, Stepper, Switch } from "./form";
import { CloseIcon, FileIcon, PlusIcon, TicketIcon } from "./icons";
import styles from "./BookingSection.module.css";

export type BookingDraft = {
  enabled: boolean;
  time: string;
  party: number | null;
  code: string;
  url: string;
  status: ReservationStatus;
  added: PendingFile[];
  removed: Attachment[];
};

export type BookingErrors = { url?: string | undefined };

type Props = {
  draft: BookingDraft;
  existing: Attachment[];
  errors: BookingErrors;
  subtitle: string;
  onChange: (next: BookingDraft) => void;
};

const STATUS_TONE: Record<ReservationStatus, string> = {
  confirmed: "var(--color-ok)",
  pending: "var(--color-transit)",
  payment_due: "var(--color-danger)",
};

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileBadge({ type }: { type: AttachmentType }) {
  return type === "application/pdf" ? (
    <span className={`${styles.badge} ${styles.pdf}`}>PDF</span>
  ) : (
    <span className={styles.badge}>
      <FileIcon size={18} />
    </span>
  );
}

export function BookingSection({ draft, existing, errors, subtitle, onChange }: Props) {
  const ids = useId();
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BookingDraft>) => {
    onChange({ ...draft, ...patch });
  };
  const kept = existing.filter((a) => !draft.removed.some((r) => r.id === a.id));
  const fileCount = kept.length + draft.added.length;

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
    <section className="group glass" aria-label="訂位資訊">
      <div className="row">
        <span className="icon-tile ok">
          <TicketIcon size={18} />
        </span>
        <span className="row-text">
          <label htmlFor={`${ids}-on`} className="row-title">
            有訂位或票券
          </label>
          <small>{draft.enabled ? subtitle : "時間、代號、確認信與附件"}</small>
        </span>
        <Switch
          id={`${ids}-on`}
          label="有訂位或票券"
          checked={draft.enabled}
          onChange={(enabled) => {
            set({ enabled });
          }}
        />
      </div>

      {draft.enabled && (
        <>
          <div className="row">
            <label htmlFor={`${ids}-time`} className="row-label">
              訂位時間
            </label>
            <input
              id={`${ids}-time`}
              type="time"
              className="pill-input"
              value={draft.time}
              onChange={(e) => {
                set({ time: e.target.value });
              }}
            />
          </div>
          <div className="row">
            <Stepper
              label="人數"
              value={draft.party}
              min={1}
              max={999}
              nullable
              onChange={(party) => {
                set({ party });
              }}
            />
          </div>
          <div className="row">
            <label htmlFor={`${ids}-code`} className="row-label fixed">
              訂位代號
            </label>
            <input
              id={`${ids}-code`}
              className="row-input mono"
              maxLength={200}
              placeholder="例如 KY-2048"
              value={draft.code}
              onChange={(e) => {
                set({ code: e.target.value });
              }}
            />
          </div>
          <div className="row">
            <label htmlFor={`${ids}-url`} className="row-label fixed">
              確認連結
            </label>
            <input
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              className="row-input"
              maxLength={2000}
              placeholder="https://…"
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={errors.url ? `${ids}-url-err` : undefined}
              value={draft.url}
              onChange={(e) => {
                set({ url: e.target.value });
              }}
            />
          </div>
          <FieldError id={`${ids}-url-err`} message={errors.url} />

          <div className={styles.block}>
            <span className="row-label">狀態</span>
            <Segmented
              label="訂位狀態"
              value={draft.status}
              options={RESERVATION_STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABEL[s],
                icon: <span className="dot" style={{ color: STATUS_TONE[s] }} aria-hidden="true" />,
              }))}
              onChange={(status) => {
                set({ status });
              }}
            />
          </div>

          <div className={styles.block}>
            <span className="row-label">
              附件{fileCount > 0 && <small className={styles.count}> {fileCount} 個</small>}
            </span>
            {fileCount > 0 && (
              <ul className={styles.files} aria-label="附件">
                {kept.map((a) => (
                  <li key={a.id}>
                    <FileBadge type={a.content_type} />
                    <button type="button" className={styles.fileName} onClick={() => void openAttachment(a)}>
                      <strong>{a.filename}</strong>
                      <small>{formatSize(a.size)} · 點擊開啟</small>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`移除 ${a.filename}`}
                      onClick={() => {
                        set({ removed: [...draft.removed, a] });
                      }}
                    >
                      <CloseIcon size={16} />
                    </button>
                  </li>
                ))}
                {draft.added.map((f) => (
                  <li key={f.id}>
                    <FileBadge type={f.contentType} />
                    <span className={styles.fileName}>
                      <strong>{f.filename}</strong>
                      <small>{formatSize(f.blob.size)} · 儲存後上傳</small>
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`移除 ${f.filename}`}
                      onClick={() => {
                        set({ added: draft.added.filter((x) => x.id !== f.id) });
                      }}
                    >
                      <CloseIcon size={16} />
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
              <strong>
                <PlusIcon size={16} />
                {busy ? "處理中…" : "附上截圖或 PDF"}
              </strong>
              <small>JPG、PNG、WebP、PDF</small>
            </label>
            {fileError && (
              <p className="error-text" role="alert">
                {fileError}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

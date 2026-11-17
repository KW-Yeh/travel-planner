import { useState, type SubmitEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { STOP_KINDS, type Stop, type StopKind } from "../../shared/schema";
import { describeDate, formatDuration, formatHhmm } from "../../shared/time";
import { BookingSection, type BookingDraft } from "../components/BookingSection";
import { FieldError, PickerRow, Segmented, Sheet, Switch } from "../components/form";
import { CloseIcon, KindIcon, PinIcon } from "../components/icons";
import { PlaceSearch, type PickedPlace } from "../components/PlaceSearch";
import { deleteStop, saveStop, type Placement, type StopInput } from "../data/actions";
import { safeUrl, saveBooking, type ReservationInput } from "../data/bookings";
import { KIND_DEFAULT_STAY, KIND_LABEL, STAY_OPTIONS } from "../data/labels";
import { stopsOfDay, useTripBundle, type TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";
import { tripPlaces } from "../data/tripPlaces";
import { selectDay } from "./TripLayout";

type StopErrors = { name?: string | undefined; url?: string | undefined };

const KEEP = "keep";
const UNSCHEDULED = "unscheduled";
const START = "start";
const END = "end";

function stayOptions(current: number): number[] {
  return STAY_OPTIONS.includes(current) ? STAY_OPTIONS : [...STAY_OPTIONS, current].sort((a, b) => a - b);
}

type EditorProps = { bundle: TripBundle; stop: Stop | null; initialDayId: string | null; startWithBooking: boolean };

function Editor({ bundle, stop, initialDayId, startWithBooking }: EditorProps) {
  const navigate = useNavigate();
  const { trip } = bundle;
  const reservation = stop ? (bundle.reservations.find((r) => r.stop_id === stop.id) ?? null) : null;
  const existingFiles = reservation ? bundle.attachments.filter((a) => a.reservation_id === reservation.id) : [];
  const [booking, setBooking] = useState<BookingDraft>({
    enabled: reservation !== null || startWithBooking,
    time: reservation?.time ?? "",
    party: reservation ? reservation.party_size : trip.party_size,
    code: reservation?.code ?? "",
    url: reservation?.url ?? "",
    status: reservation?.status ?? "confirmed",
    added: [],
    removed: [],
  });
  const [name, setName] = useState(stop?.name ?? "");
  const [kind, setKind] = useState<StopKind>(stop?.kind ?? "sight");
  const [dayId, setDayId] = useState<string | null>(stop ? stop.day_id : initialDayId);
  const [placement, setPlacement] = useState(stop ? KEEP : END);
  const [arrivalMode, setArrivalMode] = useState(stop?.arrival_mode ?? "auto");
  const [fixedTime, setFixedTime] = useState(stop?.fixed_time ?? "12:00");
  const [stay, setStay] = useState(stop?.stay_minutes ?? KIND_DEFAULT_STAY.sight);
  const [stayTouched, setStayTouched] = useState(Boolean(stop));
  const [note, setNote] = useState(stop?.note ?? "");
  const [place, setPlace] = useState<(PickedPlace & { fetchedAt: number | null }) | null>(
    stop && (stop.place_id || stop.lat !== null)
      ? { placeId: stop.place_id, name: stop.name, address: stop.address, lat: stop.lat, lng: stop.lng, fetchedAt: stop.place_fetched_at }
      : null,
  );
  const [errors, setErrors] = useState<StopErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dayStops = stopsOfDay(bundle, dayId).filter((s) => s.id !== stop?.id);
  const sameDay = stop !== null && dayId === stop.day_id;
  const day = bundle.days.find((d) => d.id === dayId);
  const autoArrival = stop && day && sameDay ? dayTimeline(bundle, day).entries.find((e) => e.stop.id === stop.id)?.arrival : null;
  const back = `/trips/${trip.id}${dayId ? `?day=${dayId}` : ""}`;
  const located = [...dayStops, ...bundle.stops].find((s) => s.lat !== null && s.lng !== null);
  const bias = located?.lat != null && located.lng != null ? { lat: located.lat, lng: located.lng } : null;
  const quickPlaces = tripPlaces(bundle.stops, stop?.id ?? null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: StopErrors = {};
    if (!name.trim()) found.name = "請輸入地點名稱。";
    let reservationInput: ReservationInput | null = null;
    if (booking.enabled) {
      const url = booking.url.trim() ? safeUrl(booking.url) : null;
      if (booking.url.trim() && !url) found.url = "確認連結需要是 http 或 https 開頭的網址。";
      reservationInput = {
        time: booking.time || null,
        party_size: booking.party,
        code: booking.code.trim() || null,
        url,
        status: booking.status,
      };
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const input: StopInput = {
      name: name.trim(),
      kind,
      arrival_mode: arrivalMode,
      fixed_time: arrivalMode === "fixed" ? fixedTime : null,
      stay_minutes: stay,
      note: note.trim() || null,
      place_id: place?.placeId ?? null,
      address: place?.address ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      place_fetched_at: place ? place.fetchedAt : null,
    };
    let where: Placement | "keep";
    if (placement === KEEP && sameDay) where = "keep";
    else if (placement === START) where = { dayId, at: "start" };
    else if (placement === END || placement === KEEP) where = { dayId, at: "end" };
    else where = { dayId, at: { after: placement } };
    const savedId = await saveStop(trip.id, stop?.id ?? null, input, where);
    if (reservationInput || reservation) {
      await saveBooking(trip.id, savedId, reservation, reservationInput, booking.added, booking.removed);
    }
    void navigate(back, { replace: true });
  }

  const dayOptions = [
    ...bundle.days.map((d, i) => {
      const date = describeDate(d.date);
      return { value: d.id, label: `Day ${i + 1} · ${date.md} ${date.weekday}` };
    }),
    { value: UNSCHEDULED, label: "尚未排入" },
  ];
  const placementOptions = [
    ...(stop && sameDay ? [{ value: KEEP, label: "目前位置" }] : []),
    { value: START, label: "最前面" },
    ...dayStops.map((s) => ({ value: s.id, label: `${s.name}之後` })),
    { value: END, label: "最後" },
  ];

  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={back} className="topbar-text-btn">
          取消
        </Link>
        <h1 className="topbar-center">{stop ? "編輯地點" : "新增地點"}</h1>
        <button type="submit" form="stop-form" className="btn btn-primary btn-pill topbar-save">
          儲存
        </button>
      </header>
      <form id="stop-form" className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="field">
          <PlaceSearch
            bias={bias}
            quick={quickPlaces}
            onPick={(picked) => {
              // A reused trip place keeps its original fetch time, so the 30-day coordinate refresh still applies.
              const fetchedAt = picked.fetchedAt !== undefined ? picked.fetchedAt : picked.lat !== null ? Date.now() : null;
              setPlace({ ...picked, fetchedAt });
              if (picked.name) setName(picked.name);
              // A new stop also takes the reused place's kind (e.g. the hotel stays lodging).
              if (!stop && picked.kind) {
                setKind(picked.kind);
                if (!stayTouched) setStay(KIND_DEFAULT_STAY[picked.kind]);
              }
              setErrors({});
            }}
          />
          {place && (
            <div className="card glass place-card">
              <span className="icon-tile">
                <PinIcon size={18} />
              </span>
              <span className="place-card-text">
                <strong>{place.address ?? (place.lat !== null && place.lng !== null ? `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}` : "已連結 Google 地點")}</strong>
                <small>{place.lat !== null ? "已取得座標，可計算交通時間與顯示在地圖上" : "沒有座標"}</small>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="移除已連結的地點"
                onClick={() => {
                  setPlace(null);
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>
          )}
        </div>

        <div>
          <p className="group-caption">名稱與類型</p>
          <div className="group glass">
            <div className="row">
              <label htmlFor="stop-name" className="row-label fixed">
                地點名稱
              </label>
              <input
                id="stop-name"
                className="row-input"
                value={name}
                maxLength={200}
                placeholder="例如 清水寺"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "stop-name-err" : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((prev) => ({ ...prev, name: undefined }));
                }}
              />
            </div>
            <FieldError id="stop-name-err" message={errors.name} />
            <Segmented
              variant="tile"
              label="類型"
              value={kind}
              options={STOP_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], icon: <KindIcon kind={k} size={20} /> }))}
              onChange={(k) => {
                setKind(k);
                if (!stayTouched) setStay(KIND_DEFAULT_STAY[k]);
              }}
            />
          </div>
        </div>

        <div>
          <p className="group-caption">安排</p>
          <div className="group glass">
            <PickerRow
              label="日期"
              value={dayId ?? UNSCHEDULED}
              options={dayOptions}
              onChange={(v) => {
                setDayId(v === UNSCHEDULED ? null : v);
                setPlacement(END);
              }}
            />
            <PickerRow label="排在" value={placement} options={placementOptions} onChange={setPlacement} />
            <PickerRow
              label="停留時間"
              layout="grid"
              value={stay}
              options={stayOptions(stay).map((m) => ({ value: m, label: m === 0 ? "不停留" : formatDuration(m) }))}
              onChange={(m) => {
                setStay(m);
                setStayTouched(true);
              }}
              extra={(close) => (
                <CustomMinutes
                  onApply={(m) => {
                    setStay(m);
                    setStayTouched(true);
                    close();
                  }}
                />
              )}
            />
            <div className="row">
              <span className="row-text">
                <label htmlFor="stop-fixed-on" className="row-title">
                  固定抵達時間
                </label>
                <small>
                  {arrivalMode === "fixed"
                    ? "例如開場時間，後面的行程不會推擠它"
                    : `關閉時自動推算${autoArrival != null ? `：約 ${formatHhmm(autoArrival)}` : ""}`}
                </small>
              </span>
              <Switch
                id="stop-fixed-on"
                label="固定抵達時間"
                checked={arrivalMode === "fixed"}
                onChange={(on) => {
                  setArrivalMode(on ? "fixed" : "auto");
                }}
              />
            </div>
            {arrivalMode === "fixed" && (
              <div className="row">
                <label htmlFor="stop-fixed" className="row-label">
                  抵達時刻
                </label>
                <input
                  id="stop-fixed"
                  type="time"
                  className="pill-input"
                  value={fixedTime}
                  onChange={(e) => {
                    if (e.target.value) setFixedTime(e.target.value);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <BookingSection
          draft={booking}
          existing={existingFiles}
          errors={{ url: errors.url }}
          subtitle={name.trim() || "訂位資訊"}
          onChange={(next) => {
            if (next.url !== booking.url) setErrors((prev) => ({ ...prev, url: undefined }));
            setBooking(next);
          }}
        />

        <div>
          <p className="group-caption">
            <label htmlFor="stop-note">備註</label>
          </p>
          <div className="group glass">
            <textarea
              id="stop-note"
              className="textarea"
              rows={3}
              maxLength={5000}
              placeholder="營業時間、想吃的東西、注意事項…"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </div>
        </div>

        {stop && (
          <>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              刪除地點
            </button>
            <Sheet open={confirmDelete} onOpenChange={setConfirmDelete} title={`刪除「${stop.name}」？`}>
              <p className="hint">{reservation ? "這個地點的訂位與附件也會一起刪除，" : ""}所有裝置上都會消失。</p>
              <button
                type="button"
                className="btn btn-danger btn-block"
                onClick={() => {
                  void deleteStop(stop).then(() => navigate(back, { replace: true }));
                }}
              >
                刪除地點
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-block"
                onClick={() => {
                  setConfirmDelete(false);
                }}
              >
                取消
              </button>
            </Sheet>
          </>
        )}
      </form>
    </div>
  );
}

function CustomMinutes({ onApply }: { onApply: (minutes: number) => void }) {
  const [value, setValue] = useState("");
  const minutes = Number(value);
  const valid = value !== "" && Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440;
  return (
    <div className="group">
      <div className="row">
        <label htmlFor="stay-custom" className="row-label">
          自訂（分鐘）
        </label>
        <input
          id="stay-custom"
          className="pill-input"
          inputMode="numeric"
          placeholder="例如 200"
          style={{ width: 96, textAlign: "right" }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, ""));
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => {
            onApply(minutes);
          }}
        >
          套用
        </button>
      </div>
    </div>
  );
}

export function StopEditor() {
  const { tripId, stopId } = useParams();
  const [params] = useSearchParams();
  const bundle = useTripBundle(tripId);
  if (bundle === undefined) return null;
  if (bundle === null) return <p className="empty">找不到這趟旅程。</p>;
  const stop = stopId ? (bundle.stops.find((s) => s.id === stopId) ?? null) : null;
  if (stopId && !stop) return <p className="empty">找不到這個地點，可能已被刪除。</p>;
  const initialDayId = selectDay(bundle, params.get("day"))?.id ?? null;
  return (
    <Editor
      key={stop?.id ?? "new"}
      bundle={bundle}
      stop={stop}
      initialDayId={initialDayId}
      startWithBooking={params.get("booking") === "1"}
    />
  );
}

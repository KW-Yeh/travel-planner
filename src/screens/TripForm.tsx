import { Command } from "cmdk";
import { useMemo, useState, type SubmitEvent } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { zhTW } from "react-day-picker/locale/zh-TW";
import { Link, useNavigate, useParams } from "react-router";
import type { Trip } from "../../shared/schema";
import { describeDate } from "../../shared/time";
import { FieldError, RowButton, Sheet, Stepper } from "../components/form";
import { createTrip, deleteTrip, deviceTimeZone, updateTrip, type TripInput } from "../data/actions";
import { useTripBundle } from "../data/queries";

const MAX_DAYS = 60;
const MS_PER_DAY = 86_400_000;

type TripProblem = { field: "name" | "dates" | "party"; message: string };

export function validateTrip(input: TripInput): TripProblem | null {
  if (!input.name.trim()) return { field: "name", message: "請輸入旅程名稱。" };
  if (Boolean(input.start_date) !== Boolean(input.end_date)) return { field: "dates", message: "請同時填寫開始與結束日期，或兩者都留空。" };
  if (input.start_date && input.end_date) {
    if (input.end_date < input.start_date) return { field: "dates", message: "結束日期不能早於開始日期。" };
    const days = (Date.parse(input.end_date) - Date.parse(input.start_date)) / MS_PER_DAY + 1;
    if (days > MAX_DAYS) return { field: "dates", message: `一趟旅程最多 ${MAX_DAYS} 天。` };
  }
  if (!Number.isInteger(input.party_size) || input.party_size < 1 || input.party_size > 99) return { field: "party", message: "人數需介於 1 到 99。" };
  return null;
}

/** "YYYY-MM-DD" ↔ a local-midnight Date, which is what the calendar works in. */
function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function shortDate(iso: string): string {
  const d = describeDate(iso);
  return `${d.md} ${d.weekday}`;
}

function zoneParts(timeZone: string): { city: string; name: string; offset: string } {
  const part = (style: "longGeneric" | "shortOffset") =>
    new Intl.DateTimeFormat("zh-TW", { timeZone, timeZoneName: style }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  return { city: (timeZone.split("/").pop() ?? timeZone).replaceAll("_", " "), name: part("longGeneric"), offset: part("shortOffset") };
}

function TimeZonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = zoneParts(value);
  const zones = useMemo(() => {
    if (!open) return [];
    const all = Intl.supportedValuesOf("timeZone");
    return (all.includes(value) ? all : [value, ...all]).map((tz) => ({ tz, ...zoneParts(tz) }));
  }, [open, value]);
  return (
    <>
      <RowButton
        label="時區"
        value={`${current.city} · ${current.offset}`}
        onClick={() => {
          setOpen(true);
        }}
      />
      <Sheet open={open} onOpenChange={setOpen} title="時區">
        <Command label="時區" loop>
          <Command.Input className="command-input" placeholder="搜尋城市或時區，例如 Tokyo、台北" />
          <Command.List className="command-list">
            <Command.Empty className="command-empty">找不到符合的時區</Command.Empty>
            {zones.map((z) => (
              <Command.Item
                key={z.tz}
                value={z.tz}
                keywords={[z.city, z.name, z.offset]}
                className={z.tz === value ? "command-item current" : "command-item"}
                onSelect={() => {
                  onChange(z.tz);
                  setOpen(false);
                }}
              >
                {z.tz}
                <small>
                  {z.name} · {z.offset}
                </small>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Sheet>
    </>
  );
}

function Form({ trip }: { trip: Trip | null }) {
  const navigate = useNavigate();
  const [name, setName] = useState(trip?.name ?? "");
  const [start, setStart] = useState(trip?.start_date ?? "");
  const [end, setEnd] = useState(trip?.end_date ?? "");
  const [party, setParty] = useState(trip?.party_size ?? 2);
  const [timeZone, setTimeZone] = useState(trip?.time_zone ?? deviceTimeZone());
  const [problem, setProblem] = useState<TripProblem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected: DateRange | undefined = start ? { from: toDate(start), to: end ? toDate(end) : undefined } : undefined;
  const days = start && end ? Math.round((toDate(end).getTime() - toDate(start).getTime()) / MS_PER_DAY) + 1 : 0;

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: TripInput = {
      name: name.trim(),
      start_date: start || null,
      end_date: end || null,
      party_size: party,
      time_zone: timeZone,
    };
    const found = validateTrip(input);
    setProblem(found);
    if (found) return;
    if (trip) {
      await updateTrip(trip.id, input);
      void navigate(`/trips/${trip.id}`, { replace: true });
    } else {
      const id = await createTrip(input);
      void navigate(`/trips/${id}`, { replace: true });
    }
  }

  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={trip ? `/trips/${trip.id}` : "/"} className="topbar-text-btn">
          取消
        </Link>
        <h1 className="topbar-center">{trip ? "編輯旅程" : "建立旅程"}</h1>
        <button type="submit" form="trip-form" className="btn btn-primary btn-pill topbar-save">
          儲存
        </button>
      </header>
      <form id="trip-form" className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <div>
          <p className="group-caption">
            <label htmlFor="trip-name">旅程名稱</label>
          </p>
          <div className="group glass">
            <div className="row">
              <input
                id="trip-name"
                className="row-input"
                style={{ textAlign: "left", fontSize: 17, fontWeight: 600 }}
                value={name}
                maxLength={200}
                placeholder="例如 京都賞櫻 3 日"
                aria-invalid={problem?.field === "name" ? true : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (problem?.field === "name") setProblem(null);
                }}
              />
            </div>
            <FieldError id="trip-name-err" message={problem?.field === "name" ? problem.message : undefined} />
          </div>
        </div>

        <div>
          <p className="group-caption">日期</p>
          <div className="group glass">
            <div className="range-head" aria-live="polite">
              <div>
                <span>開始</span>
                <strong>{start ? shortDate(start) : "—"}</strong>
              </div>
              <div>
                <span>結束</span>
                <strong>{end ? shortDate(end) : "—"}</strong>
              </div>
            </div>
            <DayPicker
              className="calendar"
              mode="range"
              locale={zhTW}
              captionLayout="dropdown"
              startMonth={new Date(new Date().getFullYear() - 1, 0)}
              endMonth={new Date(new Date().getFullYear() + 5, 11)}
              defaultMonth={start ? toDate(start) : new Date()}
              max={MAX_DAYS}
              selected={selected}
              onSelect={(range: DateRange | undefined) => {
                setStart(range?.from ? toIso(range.from) : "");
                setEnd(range?.to ? toIso(range.to) : range?.from ? toIso(range.from) : "");
                if (problem?.field === "dates") setProblem(null);
              }}
            />
            <div className="calendar-foot">
              <span>{days ? `${days} 天 · ` : ""}點選開始日，再點結束日；可以先留空</span>
              {start && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setStart("");
                    setEnd("");
                  }}
                >
                  清除
                </button>
              )}
            </div>
            <FieldError id="trip-dates-err" message={problem?.field === "dates" ? problem.message : undefined} />
          </div>
          <p className="hint" style={{ margin: "8px 4px 0" }}>
            縮短日期時，被移除那幾天的地點會移到「尚未排入」。
          </p>
        </div>

        <div>
          <p className="group-caption">其他</p>
          <div className="group glass">
            <div className="row">
              <Stepper
                label="人數"
                value={party}
                min={1}
                max={99}
                onChange={(next) => {
                  if (next !== null) setParty(next);
                }}
              />
            </div>
            <TimeZonePicker value={timeZone} onChange={setTimeZone} />
          </div>
        </div>

        {trip && (
          <>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              刪除旅程
            </button>
            <Sheet open={confirmDelete} onOpenChange={setConfirmDelete} title={`刪除「${trip.name}」？`}>
              <p className="hint">刪除後，所有裝置上的這趟旅程都會消失。</p>
              <button
                type="button"
                className="btn btn-danger btn-block"
                onClick={() => {
                  void deleteTrip(trip.id).then(() => navigate("/", { replace: true }));
                }}
              >
                刪除旅程
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

export function TripForm() {
  const { tripId } = useParams();
  const bundle = useTripBundle(tripId);
  if (tripId && bundle === undefined) return null;
  if (tripId && bundle === null) return <p className="empty">找不到這趟旅程。</p>;
  return <Form trip={bundle?.trip ?? null} key={bundle?.trip.id ?? "new"} />;
}

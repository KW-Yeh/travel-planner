import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { directionsUrl } from "../../shared/maps-links";
import type { Day, Leg, Stop } from "../../shared/schema";
import { describeDate, formatHhmm } from "../../shared/time";
import { parseTrack } from "../../shared/track";
import { BackIcon, ModeIcon, NavigateIcon } from "../components/icons";
import { MODE_LABEL } from "../data/labels";
import type { TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";
import { arcPath } from "../maps/arc";
import { focusPoints, type FocusPoint } from "../maps/focus";
import { mapsLibrary, useMapsConfig, useOnline } from "../maps/google";
import { dragScroll } from "../components/dragScroll";
import styles from "./MapView.module.css";
import { useTripContext } from "./TripLayout";

const ALL = "all";
// One colour per day in the 全部 view; readable on the default light basemap.
const DAY_COLORS = ["#1d4ed8", "#b45309", "#047857", "#9d174d", "#6d28d9", "#0e7490", "#4d7c0f"];

type Row = { stop: Stop; number: number; dayIndex: number; arrival: number | null; legIn: Leg | null; prev: Stop | null };

function rowsFor(bundle: TripBundle, days: Day[]): Row[] {
  return days.flatMap((day) => {
    const dayIndex = bundle.days.indexOf(day);
    const entries = dayTimeline(bundle, day).entries;
    return entries.map((e, i) => ({
      stop: e.stop,
      number: i + 1,
      dayIndex,
      arrival: e.arrival,
      legIn: e.legIn ?? null,
      prev: i > 0 ? (entries[i - 1]?.stop ?? null) : null,
    }));
  });
}

const hasCoords = (s: Stop): s is Stop & { lat: number; lng: number } => s.lat !== null && s.lng !== null;

function place(s: Stop) {
  return { name: s.name, placeId: s.place_id, lat: s.lat, lng: s.lng };
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function GoogleMap({ apiKey, mapId, rows, selected, onSelect }: { apiKey: string; mapId: string | null; rows: Row[]; selected: string | null; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const overlays = useRef<{ clear: () => void }[]>([]);
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const run = { cancelled: false };
    void (async () => {
      const [{ LatLngBounds }, { Map: GMap, Polyline }, { AdvancedMarkerElement, PinElement }, { encoding }] = await Promise.all([
        mapsLibrary(apiKey, "core"),
        mapsLibrary(apiKey, "maps"),
        mapsLibrary(apiKey, "marker"),
        mapsLibrary(apiKey, "geometry"),
      ]);
      if (run.cancelled || !container.current) return;
      map.current ??= new GMap(container.current, {
        // Advanced markers need a map id; DEMO_MAP_ID is Google's documented stand-in for development.
        mapId: mapId ?? "DEMO_MAP_ID",
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        clickableIcons: false,
      });
      for (const o of overlays.current) o.clear();
      overlays.current = [];
      const bounds = new LatLngBounds();
      const placed: FocusPoint[] = [];
      const animate = !reducedMotion();

      for (const row of rows) {
        const color = DAY_COLORS[row.dayIndex % DAY_COLORS.length] ?? "#1d4ed8";
        if (row.prev && hasCoords(row.prev) && hasCoords(row.stop)) {
          const walking = row.legIn?.mode === "walk";
          const dashes = walking ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: color, scale: 3 }, offset: "0", repeat: "12px" }] : [];
          const from = { lat: row.prev.lat, lng: row.prev.lng };
          const to = { lat: row.stop.lat, lng: row.stop.lng };
          const lines: google.maps.Polyline[] = [];
          const track = row.legIn?.polyline ? parseTrack(row.legIn.polyline) : null;
          if (track) {
            // NAVITIME track: each ride in its line colour over a white casing; walking dashed in the day colour.
            const walkDashes = [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: color, scale: 3 }, offset: "0", repeat: "12px" }];
            for (const seg of track) {
              const path = encoding.decodePath(seg.path);
              if (seg.walk) {
                lines.push(new Polyline({ map: map.current, path, strokeOpacity: 0, strokeWeight: 4, icons: walkDashes, clickable: false }));
              } else {
                lines.push(
                  new Polyline({ map: map.current, path, strokeColor: "#ffffff", strokeOpacity: 0.95, strokeWeight: 8, zIndex: 2, clickable: false }),
                  new Polyline({ map: map.current, path, strokeColor: seg.color ?? color, strokeOpacity: 0.95, strokeWeight: 5, zIndex: 3, clickable: false }),
                );
              }
            }
          } else if (row.legIn?.polyline) {
            lines.push(
              new Polyline({ map: map.current, path: encoding.decodePath(row.legIn.polyline), strokeColor: color, strokeOpacity: walking ? 0 : 0.85, strokeWeight: 4, icons: dashes }),
            );
          } else {
            // No real route (typed in by hand): a raised arc over a ground shadow, so it reads as a sketch, not a road.
            const arc = arcPath(from, to);
            lines.push(
              new Polyline({ map: map.current, path: [from, to], strokeColor: "#15202b", strokeOpacity: 0.14, strokeWeight: 6, zIndex: 1, clickable: false }),
              new Polyline({ map: map.current, path: arc, strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 8, zIndex: 2, clickable: false }),
              new Polyline({
                map: map.current,
                path: arc,
                strokeColor: color,
                strokeOpacity: walking ? 0 : 0.9,
                strokeWeight: 4,
                zIndex: 3,
                clickable: false,
                icons: [...dashes, { icon: { path: "M -2.4,2 0,-2 2.4,2 z", fillColor: color, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 1.2, scale: 2.4 }, offset: "55%" }],
              }),
            );
          }
          overlays.current.push({
            clear: () => {
              for (const line of lines) line.setMap(null);
            },
          });
        }
        if (!hasCoords(row.stop)) continue;
        const pin = new PinElement({ glyphText: String(row.number), background: color, borderColor: "#ffffff", glyphColor: "#ffffff" });
        if (animate && styles.pop) pin.classList.add(styles.pop);
        const marker = new AdvancedMarkerElement({ map: map.current, position: { lat: row.stop.lat, lng: row.stop.lng }, content: pin, title: `${String(row.number)}. ${row.stop.name}`, gmpClickable: true });
        const stopId = row.stop.id;
        marker.addEventListener("gmp-click", () => {
          onSelectRef.current(stopId);
        });
        overlays.current.push({ clear: () => (marker.map = null) });
        placed.push({ lat: row.stop.lat, lng: row.stop.lng, transport: row.stop.kind === "transport" });
      }
      for (const p of focusPoints(placed)) bounds.extend(p);
      if (!bounds.isEmpty()) map.current.fitBounds(bounds, 48);
    })().catch(() => {
      if (!run.cancelled) setFailed(true);
    });
    return () => {
      run.cancelled = true;
    };
  }, [apiKey, mapId, rows]);

  useEffect(() => {
    const stop = rows.find((r) => r.stop.id === selected)?.stop;
    if (stop && hasCoords(stop)) map.current?.panTo({ lat: stop.lat, lng: stop.lng });
  }, [rows, selected]);

  if (failed) return <p className="hint">地圖載入失敗，下方仍可查看行程清單。</p>;
  return <div ref={container} className={styles.map} role="region" aria-label="行程地圖" />;
}

function useFallback(rows: Row[]): string | null {
  const config = useMapsConfig();
  const online = useOnline();
  const located = rows.filter((r) => hasCoords(r.stop)).length;
  if (config && !config.mapsBrowserKey) return "尚未設定 Google 地圖金鑰，先以清單顯示。";
  if (!online) return "離線中，地圖無法載入；清單與已排好的時間仍可查看。";
  if (rows.length > 0 && located === 0) return "這些地點都還沒有座標。到地點裡用搜尋選取，就會出現在地圖上。";
  return null;
}

/** The selected day's route, shown beside the timeline on wide screens. */
export function DayMap({ bundle, day, selected, onSelect }: { bundle: TripBundle; day: Day | null; selected: string | null; onSelect: (stopId: string) => void }) {
  const config = useMapsConfig();
  const rows = useMemo(() => rowsFor(bundle, day ? [day] : []), [bundle, day]);
  const fallback = useFallback(rows);
  return (
    <div className={styles.dayMap}>
      {config?.mapsBrowserKey && !fallback && <GoogleMap apiKey={config.mapsBrowserKey} mapId={config.mapId} rows={rows} selected={selected} onSelect={onSelect} />}
      {fallback && <p className={`hint ${styles.mapNote}`}>{fallback}</p>}
    </div>
  );
}

export function MapView() {
  const { bundle, day, search } = useTripContext();
  const config = useMapsConfig();
  const [scope, setScope] = useState<string>(day?.id ?? ALL);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useMemo(() => rowsFor(bundle, scope === ALL ? bundle.days : bundle.days.filter((d) => d.id === scope)), [bundle, scope]);
  const fallback = useFallback(rows);

  return (
    <div className={`screen ${styles.view}`}>
      <header className="topbar glass">
        <Link to={`/trips/${bundle.trip.id}${search}`} className={`icon-btn ${styles.back}`} aria-label="返回行程">
          <BackIcon />
        </Link>
        <div className="topbar-titles">
          <h1>地圖</h1>
          <p>{bundle.trip.name}</p>
        </div>
      </header>

      <div ref={dragScroll} className={`chips ${styles.days}`} role="group" aria-label="選擇日期">
        {bundle.days.map((d, i) => (
          <button
            key={d.id}
            type="button"
            className="chip"
            aria-pressed={scope === d.id}
            onClick={() => {
              setScope(d.id);
            }}
          >
            Day {i + 1} · {describeDate(d.date).md}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={scope === ALL}
          onClick={() => {
            setScope(ALL);
          }}
        >
          全部
        </button>
      </div>

      {config?.mapsBrowserKey && !fallback && <GoogleMap apiKey={config.mapsBrowserKey} mapId={config.mapId} rows={rows} selected={selected} onSelect={setSelected} />}
      {fallback && <p className={`hint ${styles.fallback}`}>{fallback}</p>}

      <section className={`${styles.panel} glass`} aria-label="地點清單">
        {rows.length === 0 && <p className="empty">這天還沒有地點。</p>}
        <ol className={styles.list}>
          {rows.map((row) => {
            const color = DAY_COLORS[row.dayIndex % DAY_COLORS.length];
            const firstOfDay = scope === ALL && row.number === 1;
            return (
              <li key={row.stop.id} className={styles.item} aria-current={selected === row.stop.id ? "true" : undefined}>
                {firstOfDay && <h2 className={styles.dayHead}>Day {row.dayIndex + 1}</h2>}
                {row.prev && (
                  <a className={styles.leg} href={directionsUrl(place(row.prev), place(row.stop), row.legIn?.mode ?? "transit")} target="_blank" rel="noopener noreferrer">
                    <ModeIcon mode={row.legIn?.mode ?? "transit"} size={16} />
                    {MODE_LABEL[row.legIn?.mode ?? "transit"]}
                    {row.legIn?.minutes != null ? ` ${String(row.legIn.minutes)} 分` : ""}
                    <span className={styles.legGo}>
                      <NavigateIcon size={14} /> 導航
                    </span>
                  </a>
                )}
                <button
                  type="button"
                  className={styles.stop}
                  onClick={() => {
                    setSelected(row.stop.id);
                  }}
                >
                  <span className={styles.badge} style={{ background: color }}>
                    {row.number}
                  </span>
                  <span className={styles.stopText}>
                    <strong>{row.stop.name}</strong>
                    <small>
                      {row.arrival !== null ? `${formatHhmm(row.arrival)} 抵達` : "時間未定"}
                      {!hasCoords(row.stop) && " · 沒有座標"}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

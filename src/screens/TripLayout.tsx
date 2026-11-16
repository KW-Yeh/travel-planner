import { createContext, useContext } from "react";
import { Navigate, Outlet, useLocation, useMatch, useNavigate, useParams, useSearchParams } from "react-router";
import type { Day, Stop } from "../../shared/schema";
import { TabBar } from "../components/TabBar";
import { TripNav } from "../components/TripNav";
import { useLayout } from "../components/layout";
import { useTripBundle, type TripBundle } from "../data/queries";
import { useRefreshPlaces } from "../maps/places";
import { DayMap } from "./MapView";
import { Timeline } from "./Timeline";
import styles from "./TripLayout.module.css";

export type TripContext = { bundle: TripBundle; day: Day | null; search: string };

const Ctx = createContext<TripContext | null>(null);

export function useTripContext(): TripContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTripContext outside TripLayout");
  return ctx;
}

/** Selected day comes from ?day=<id>; defaults to the first day. */
export function selectDay(bundle: TripBundle, dayParam: string | null): Day | null {
  return bundle.days.find((d) => d.id === dayParam) ?? bundle.days[0] ?? null;
}

const NO_STOPS: Stop[] = [];

export function TripLayout() {
  const { tripId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useLayout();
  const bundle = useTripBundle(tripId);
  useRefreshPlaces(bundle?.stops ?? NO_STOPS);
  const stopMatch = useMatch("/trips/:tripId/stops/:stopId");
  const legMatch = useMatch("/trips/:tripId/legs/:legId");
  const timelineMatch = useMatch("/trips/:tripId");
  if (bundle === undefined) return null;
  if (bundle === null) return <Navigate to="/" replace />;
  // An editor opened without ?day (an old link, a reload) still belongs to the day of what it edits.
  const legStopId = bundle.legs.find((l) => l.id === legMatch?.params.legId)?.to_stop_id;
  const itemDayId = bundle.stops.find((s) => s.id === (stopMatch?.params.stopId ?? legStopId))?.day_id ?? null;
  const day = selectDay(bundle, params.get("day") ?? itemDayId);
  const context: TripContext = { bundle, day, search: location.search };
  const editing = stopMatch !== null || legMatch !== null;
  const selectedStop = stopMatch?.params.stopId ?? null;
  const openStop = (stopId: string) => {
    void navigate(`/trips/${bundle.trip.id}/stops/${stopId}${day ? `?day=${day.id}` : ""}`);
  };

  let body;
  if (layout === "desktop") {
    // The timeline stays put; editors open in the side pane where the map was.
    body = (
      <div className={styles.desktop}>
        <TripNav bundle={bundle} search={location.search} />
        {editing || timelineMatch ? (
          <>
            <div className={styles.column}>
              <Timeline embedded />
            </div>
            <div className={styles.pane}>
              {editing ? <Outlet /> : <DayMap bundle={bundle} day={day} selected={selectedStop} onSelect={openStop} />}
            </div>
          </>
        ) : (
          <div className={styles.wide}>
            <Outlet />
          </div>
        )}
      </div>
    );
  } else if (editing) {
    body = <Outlet />;
  } else if (layout === "tablet" && timelineMatch) {
    body = (
      <>
        <div className={styles.tablet}>
          <div className={styles.column}>
            <Outlet />
          </div>
          <div className={styles.tabletMap}>
            <DayMap bundle={bundle} day={day} selected={null} onSelect={openStop} />
          </div>
        </div>
        <TabBar tripId={bundle.trip.id} search={location.search} />
      </>
    );
  } else {
    body = (
      <>
        <Outlet />
        <TabBar tripId={bundle.trip.id} search={location.search} />
      </>
    );
  }
  return <Ctx.Provider value={context}>{body}</Ctx.Provider>;
}

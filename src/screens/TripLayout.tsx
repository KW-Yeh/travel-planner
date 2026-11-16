import { Navigate, Outlet, useLocation, useOutletContext, useParams, useSearchParams } from "react-router";
import type { Day, Stop } from "../../shared/schema";
import { TabBar } from "../components/TabBar";
import { useTripBundle, type TripBundle } from "../data/queries";
import { useRefreshPlaces } from "../maps/places";

export type TripContext = { bundle: TripBundle; day: Day | null; search: string };

export function useTripContext(): TripContext {
  return useOutletContext<TripContext>();
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
  const bundle = useTripBundle(tripId);
  useRefreshPlaces(bundle?.stops ?? NO_STOPS);
  if (bundle === undefined) return null;
  if (bundle === null) return <Navigate to="/" replace />;
  const day = selectDay(bundle, params.get("day"));
  const context: TripContext = { bundle, day, search: location.search };
  return (
    <>
      <Outlet context={context} />
      <TabBar tripId={bundle.trip.id} search={location.search} />
    </>
  );
}

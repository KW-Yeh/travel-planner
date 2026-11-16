import { Link } from "react-router";
import { BackIcon } from "../components/icons";
import { useTripContext } from "./TripLayout";

/** Placeholder tab until its phase lands (map: phase 6, bookings: phase 5). */
export function ComingSoon({ title }: { title: string }) {
  const { bundle, search } = useTripContext();
  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={`/trips/${bundle.trip.id}${search}`} className="icon-btn" aria-label="返回行程">
          <BackIcon />
        </Link>
        <div className="topbar-titles">
          <h1>{title}</h1>
        </div>
      </header>
      <p className="empty">這個分頁還在製作中。</p>
    </div>
  );
}

import { Link, NavLink } from "react-router";
import type { TripBundle } from "../data/queries";
import { tripDateText } from "../data/summary";
import { BackIcon, EditIcon, ListIcon, MapIcon, TicketIcon } from "./icons";
import { SyncStatus } from "./SyncStatus";
import styles from "./TripNav.module.css";

/** Desktop replacement for the bottom TabBar: trip identity, tabs and sync state in one column. */
export function TripNav({ bundle, search }: { bundle: TripBundle; search: string }) {
  const { trip } = bundle;
  const tabs = [
    { to: `/trips/${trip.id}`, label: "行程", icon: <ListIcon />, end: true, count: null },
    { to: `/trips/${trip.id}/map`, label: "地圖", icon: <MapIcon />, end: false, count: null },
    { to: `/trips/${trip.id}/bookings`, label: "訂位", icon: <TicketIcon />, end: false, count: bundle.reservations.length },
  ];
  return (
    <nav aria-label="主要導覽" className={`${styles.nav} glass`}>
      <Link to="/" className={styles.back}>
        <BackIcon size={16} />
        我的旅程
      </Link>
      <div className={styles.trip}>
        <h1>{trip.name}</h1>
        <p>{tripDateText(trip)}</p>
      </div>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={{ pathname: tab.to, search }}
          end={tab.end}
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ""}`}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== null && <span className={styles.count}>{tab.count}</span>}
        </NavLink>
      ))}
      <div className={styles.spacer} />
      <Link to={`/trips/${trip.id}/edit`} className={styles.tab}>
        <EditIcon size={18} />
        編輯旅程
      </Link>
      <SyncStatus />
    </nav>
  );
}

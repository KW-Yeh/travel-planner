import { NavLink } from "react-router";
import { ListIcon, MapIcon, TicketIcon } from "./icons";
import styles from "./TabBar.module.css";

export function TabBar({ tripId, search }: { tripId: string; search: string }) {
  const tabs = [
    { to: `/trips/${tripId}`, label: "行程", icon: <ListIcon />, end: true },
    { to: `/trips/${tripId}/map`, label: "地圖", icon: <MapIcon />, end: false },
    { to: `/trips/${tripId}/bookings`, label: "訂位", icon: <TicketIcon />, end: false },
  ];
  return (
    <nav aria-label="主要導覽" className={`${styles.bar} glass`}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={{ pathname: tab.to, search }}
          end={tab.end}
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ""}`}
        >
          {tab.icon}
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

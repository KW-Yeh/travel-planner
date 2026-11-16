import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import type { MeResponse } from "../shared/api";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { Bookings } from "./screens/Bookings";
import { ComingSoon } from "./screens/ComingSoon";
import { LegEditor } from "./screens/LegEditor";
import { Login } from "./screens/Login";
import { StopEditor } from "./screens/StopEditor";
import { Timeline } from "./screens/Timeline";
import { TripForm } from "./screens/TripForm";
import { TripLayout } from "./screens/TripLayout";
import { Trips } from "./screens/Trips";

function SignedInRoutes({ user }: { user: MeResponse }) {
  return (
    <Routes>
      <Route path="/" element={<Trips user={user} />} />
      <Route path="/trips/new" element={<TripForm />} />
      <Route path="/trips/:tripId/edit" element={<TripForm />} />
      <Route path="/trips/:tripId/stops/new" element={<StopEditor />} />
      <Route path="/trips/:tripId/stops/:stopId" element={<StopEditor />} />
      <Route path="/trips/:tripId/legs/:legId" element={<LegEditor />} />
      <Route path="/trips/:tripId" element={<TripLayout />}>
        <Route index element={<Timeline />} />
        <Route path="map" element={<ComingSoon title="地圖" />} />
        <Route path="bookings" element={<Bookings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Root() {
  const { state } = useAuth();
  switch (state.status) {
    case "checking":
      return null;
    case "offline":
      return <Login offline />;
    case "signedOut":
      return <Login />;
    case "signedIn":
      return <SignedInRoutes user={state.user} />;
  }
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </AuthProvider>
  );
}

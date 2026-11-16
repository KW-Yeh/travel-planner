import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { Login } from "./screens/Login";
import { SignedIn } from "./screens/SignedIn";

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
      return <SignedIn user={state.user} />;
  }
}

export function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

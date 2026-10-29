import { useEffect, useState } from "react";
import { currentUser, type User } from "./api";

/** The signed-in user, kept in step with sign-in/sign-out anywhere on the page (and other tabs). */
export function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const sync = () => setUser(currentUser());
    sync();
    window.addEventListener("id-session", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("id-session", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return user;
}

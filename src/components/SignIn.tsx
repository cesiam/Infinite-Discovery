import { useState } from "react";
import { LogOut, X } from "lucide-react";
import { signIn, signOut, type Role } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

// Placeholder "Sign in with MIT": the backend's dev sign-in until MIT login is wired up.
export function SignIn({ className }: { className?: string }) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [error, setError] = useState("");

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden text-sm font-bold text-foreground sm:inline">
          {user.displayName}
          <span className="ml-1 text-xs text-muted-foreground">· {user.role}</span>
        </span>
        <Button size="sm" variant="outline" onClick={() => void signOut()} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Button
        size="sm"
        className={className}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="sm:hidden">Sign in</span>
        <span className="hidden sm:inline">Sign in with MIT</span>
      </Button>
      {open && (
        <form
          className="glass-strong absolute right-0 top-11 z-50 w-72 space-y-3 rounded-2xl p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await signIn(email, name, role);
              setOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Sign-in failed");
            }
          }}
        >
          <div className="flex items-center justify-between">
            <p className="label-mono">Development sign-in</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            MIT login isn&apos;t connected yet. Pick any MIT email and a role to try the app.
          </p>
          <input
            className="field"
            type="email"
            required
            placeholder="kerb@mit.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
          <input
            className="field"
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Display name"
          />
          <select
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            aria-label="Role"
          >
            <option value="student">Student</option>
            <option value="professor">Professor</option>
            <option value="admin">Admin</option>
          </select>
          {error && <p className="text-xs font-bold text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="w-full">
            Sign in
          </Button>
        </form>
      )}
    </div>
  );
}

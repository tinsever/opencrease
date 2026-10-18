// Session with the local server. The editor normally arrives signed in (the server opens it through
// /auth, which sets an HttpOnly cookie; the Vite dev server adds the token when it proxies). When it
// does not, the app shows the sign-in screen instead of failing on every request.

export interface SessionInfo {
  token: string;
  header: string;
}

let session: SessionInfo | null = null;

export type SessionState = { kind: "ok"; session: SessionInfo | null } | { kind: "locked" };

/** Check the session once at startup. Server errors are not a sign-in problem: the app handles them. */
export async function checkSession(): Promise<SessionState> {
  try {
    const res = await fetch("/api/session", { headers: { accept: "application/json" } });
    if (res.status === 401) return { kind: "locked" };
    if (!res.ok) return { kind: "ok", session: null };
    const data = (await res.json()) as { token?: string; header?: string };
    session = typeof data.token === "string" ? { token: data.token, header: data.header ?? "x-opencrease-token" } : null;
    return { kind: "ok", session };
  } catch {
    return { kind: "ok", session: null };
  }
}

/** The token, for showing HTTP MCP setup commands. Null until checkSession ran or when unknown. */
export function sessionToken(): string | null {
  return session?.token ?? null;
}

/** Sign in with a pasted token. Resolves to "ok", "invalid" or "error". */
export async function signIn(token: string): Promise<"ok" | "invalid" | "error"> {
  try {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    if (res.status === 401) return "invalid";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

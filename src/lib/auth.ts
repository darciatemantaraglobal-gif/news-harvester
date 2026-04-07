const TOKEN_KEY = "aina_auth_token";
const ADMIN_KEY = "aina_is_admin";
const USERNAME_KEY = "aina_username";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function getIsAdmin(): boolean {
  return localStorage.getItem(ADMIN_KEY) === "true";
}

export function setIsAdmin(v: boolean): void {
  localStorage.setItem(ADMIN_KEY, v ? "true" : "false");
}

export function getUsername(): string {
  return localStorage.getItem(USERNAME_KEY) || "";
}

export function setUsername(u: string): void {
  localStorage.setItem(USERNAME_KEY, u);
}

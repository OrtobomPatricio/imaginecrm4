export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Build the login URL preserving the user's tenant context when available.
export const getLoginUrl = () => {
  const tenantSlug = localStorage.getItem("tenant-slug") || "";
  if (tenantSlug) {
    return `/login?tenant=${encodeURIComponent(tenantSlug)}`;
  }
  return "/login";
};

import { useQueryClient } from "@tanstack/react-query";

interface SettingsSnapshot {
  refreshIntervalSeconds?: number;
}

/**
 * Reads the user's configured refresh interval from the shared settings cache.
 * Returns the value in milliseconds, falling back to `fallbackSeconds` if
 * settings have not yet loaded or the field is not set.
 *
 * Uses `getQueryData` so it never triggers its own network request —
 * it purely reads from the cache that is populated by the app layout.
 */
export function useRefreshInterval(fallbackSeconds = 15): number {
  const queryClient = useQueryClient();
  const data = queryClient.getQueryData<SettingsSnapshot>(["/api/settings"]);
  const seconds = data?.refreshIntervalSeconds ?? fallbackSeconds;
  return Math.max(5, seconds) * 1000;
}

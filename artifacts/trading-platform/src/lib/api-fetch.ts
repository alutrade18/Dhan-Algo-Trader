interface FetchOptions extends RequestInit {
  retries?: number;
  onRateLimit?: (retryAfterMs: number) => void;
}

let authTokenProvider: (() => Promise<string | null>) | null = null;
let interceptorInstalled = false;

export function setAuthTokenProvider(fn: () => Promise<string | null>) {
  authTokenProvider = fn;
}

/**
 * Installs a global fetch interceptor that automatically adds the Clerk
 * Authorization header to all requests that target the /api/ path.
 * Safe to call multiple times — only installs once.
 */
export function installFetchInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (authTokenProvider && url.includes("/api/")) {
      try {
        const token = await authTokenProvider();
        if (token) {
          const headers = new Headers(init?.headers);
          if (!headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${token}`);
          }
          return originalFetch(input, { ...init, headers });
        }
      } catch {
        // Token fetch failed — proceed without auth header
      }
    }

    return originalFetch(input, init);
  };
}

export async function apiFetch<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { retries = 2, onRateLimit, headers: existingHeaders, ...fetchOptions } = options;

  const authHeaders: Record<string, string> = {};
  if (authTokenProvider) {
    try {
      const token = await authTokenProvider();
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;
    } catch {
      // Token fetch failed — proceed without auth header
    }
  }

  const mergedHeaders = {
    ...authHeaders,
    ...(existingHeaders as Record<string, string> | undefined ?? {}),
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { ...fetchOptions, headers: mergedHeaders });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({})) as {
        retryAfterSeconds?: number;
        retryAfterMs?: number;
        errorMessage?: string;
      };

      const retryAfterMs =
        data.retryAfterMs ??
        (data.retryAfterSeconds ? data.retryAfterSeconds * 1000 : 1000);

      if (onRateLimit) onRateLimit(retryAfterMs);

      window.dispatchEvent(
        new CustomEvent("dhan:rate-limit", {
          detail: { retryAfterMs, url, message: data.errorMessage },
        }),
      );

      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }

      throw new Error(
        data.errorMessage ??
          `Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s`,
      );
    }

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` })) as Record<string, unknown>;
      throw new Error(
        ((err.errorMessage ?? err.error ?? `HTTP ${res.status}`) as string),
      );
    }

    return res.json() as Promise<T>;
  }

  throw new Error("Max retries exceeded");
}

// For web apps, Clerk uses session cookies automatically.
// No bearer token interceptor is needed — browsers send cookies with every same-domain request.

interface FetchOptions extends RequestInit {
  retries?: number;
  onRateLimit?: (retryAfterMs: number) => void;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { retries = 2, onRateLimit, ...fetchOptions } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, fetchOptions);

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

import { publicEnv } from './env';
import { getSupabaseServerClient } from './supabase/server';

export interface ApiOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly accessToken?: string;
  readonly cache?: RequestCache;
}

/**
 * Fetch the KeeprSteady API with the caller's Supabase access token.
 * Server components: pass `accessToken` (resolved via getSession). Client
 * components: prefer `apiFromBrowser` which mounts the supabase-js client.
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = `${publicEnv.NEXT_PUBLIC_API_URL}${path}`;
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.accessToken) headers['authorization'] = `Bearer ${opts.accessToken}`;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    cache: opts.cache ?? 'no-store',
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

/** Server-component helper: fetch with the current user's access token. */
export async function apiAsUser<T>(
  path: string,
  opts: Omit<ApiOptions, 'accessToken'> = {},
): Promise<T | null> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return api<T>(path, { ...opts, accessToken: data.session.access_token });
}

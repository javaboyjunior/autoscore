/**
 * API client — replaces Firebase Firestore.
 *
 * useCollection() and useDoc() are drop-in replacements for the Firebase
 * onSnapshot pattern. They fetch initial data from the REST API then
 * subscribe to a Server-Sent Events stream that PostgreSQL LISTEN/NOTIFY
 * powers. When a relevant change notification arrives the hook refetches
 * automatically, giving the same "instant everywhere" behaviour as Firestore.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ChangeNotification {
  table: string;      // 'events' | 'cars' | 'judges' | 'scores'
  action: string;     // 'INSERT' | 'UPDATE' | 'DELETE'
  id: string;
  event_id: string | null;
}

// ---------------------------------------------------------------------------
// Global SSE singleton — one connection shared across all hooks
// ---------------------------------------------------------------------------
class SSEClient extends EventTarget {
  private es: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;

  connect() {
    if (this.es) return;
    this._open();
  }

  private _open() {
    const es = new EventSource('/api/stream');
    this.es = es;

    es.onopen = () => {
      this.retryDelay = 1000;
    };

    es.onmessage = (e) => {
      try {
        const data: ChangeNotification = JSON.parse(e.data);
        this.dispatchEvent(new CustomEvent('change', { detail: data }));
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      es.close();
      this.es = null;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        this._open();
      }, this.retryDelay);
    };
  }
}

export const sseClient = new SSEClient();

// ---------------------------------------------------------------------------
// useCollection — fetches an array and reacts to SSE changes
//
// url: the REST endpoint, e.g. '/api/cars?eventId=xxx'
//      pass null to skip fetching (same as a null Firestore query)
//
// watchTables: table names that should trigger a refetch ('cars', etc.)
// watchEventId: only refetch when the notification's event_id matches
// ---------------------------------------------------------------------------
interface UseCollectionOptions {
  watchTables: string[];
  watchEventId?: string | null;
}

interface UseCollectionResult<T> {
  data: T[] | null;
  isLoading: boolean;
}

export function useCollection<T>(
  url: string | null,
  options: UseCollectionOptions,
): UseCollectionResult<T> {
  const [data, setData] = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // Stabilize array comparison — joins to a string so inline arrays don't
  // cause the effect to re-subscribe on every render.
  const watchTablesKey = options.watchTables.join(',');
  const watchEventId   = options.watchEventId;

  const fetchData = useCallback(() => {
    if (!url) {
      setData(null);
      setIsLoading(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<T[]>;
      })
      .then((d) => {
        setData(d);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('[useCollection] fetch error', url, err.message);
          setIsLoading(false);
        }
      });
  }, [url]);

  // Initial fetch (and refetch when url changes)
  useEffect(() => {
    setIsLoading(true);
    fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  // SSE subscription — re-subscribes only when url / tables / eventId change
  useEffect(() => {
    sseClient.connect();

    const watchTables = watchTablesKey.split(',');

    const handler = (e: Event) => {
      const { table, event_id } = (e as CustomEvent<ChangeNotification>).detail;
      if (!watchTables.includes(table)) return;
      if (watchEventId !== undefined && watchEventId !== null) {
        if (event_id !== watchEventId) return;
      }
      fetchData();
    };

    sseClient.addEventListener('change', handler);
    return () => sseClient.removeEventListener('change', handler);
  }, [fetchData, watchTablesKey, watchEventId]);

  return { data, isLoading };
}

// ---------------------------------------------------------------------------
// Non-blocking API helpers — fire-and-forget, matching the Firebase pattern
// ---------------------------------------------------------------------------
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function apiFetch(url: string, init: RequestInit) {
  return fetch(url, { ...init, headers: { ...JSON_HEADERS, ...init.headers } })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch((err) => console.error('[api]', init.method, url, err.message));
}

export const api = {
  post:   (url: string, data: unknown) => apiFetch(url, { method: 'POST',   body: JSON.stringify(data) }),
  put:    (url: string, data: unknown) => apiFetch(url, { method: 'PUT',    body: JSON.stringify(data) }),
  delete: (url: string)                => apiFetch(url, { method: 'DELETE' }),

  // Awaitable version for cases that need the returned id
  postAwait: (url: string, data: unknown): Promise<{ id: string } & Record<string, unknown>> =>
    fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) })
      .then((r) => r.json()),

  putAwait: (url: string, data: unknown): Promise<Record<string, unknown>> =>
    fetch(url, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(data) })
      .then((r) => r.json()),
};

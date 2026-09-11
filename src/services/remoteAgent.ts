// Talks to a standalone "MCL Agent" — the small daemon from src-tauri/src/bin/mcl_agent.rs
// that runs on a remote/VPS-hosted machine and exposes the exact same prepare/start/stop
// operations the desktop app runs locally in server_host.rs, over a token-authenticated HTTP
// API. This lets the Host Server tab manage a real remote server the same way it manages one
// on this computer, without SSH.
import type { HostedServerStatus, ServerPropertiesSummary } from '../types';

export interface RemoteHost {
  id: string;
  name: string;
  /** e.g. "http://203.0.113.10:8642" — no trailing slash required. */
  url: string;
  token: string;
}

const REMOTE_HOSTS_KEY = 'mcl_remote_hosts';

export function loadRemoteHosts(): RemoteHost[] {
  try {
    const raw = localStorage.getItem(REMOTE_HOSTS_KEY);
    return raw ? (JSON.parse(raw) as RemoteHost[]) : [];
  } catch {
    return [];
  }
}

export function saveRemoteHosts(hosts: RemoteHost[]) {
  try {
    localStorage.setItem(REMOTE_HOSTS_KEY, JSON.stringify(hosts));
  } catch (err) {
    console.warn('Failed to persist remote hosts:', err);
  }
}

async function agentFetch<T>(host: RemoteHost, path: string, init?: RequestInit): Promise<T> {
  const base = host.url.replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${host.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `The agent replied with HTTP ${res.status}.`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export interface RemotePrepareRequest {
  loader: string;
  gameVersion: string;
  loaderVersion?: string;
  acceptEula: boolean;
}

export interface RemoteStartRequest {
  minRam: number;
  maxRam: number;
}

export const remoteAgent = {
  status: (host: RemoteHost) => agentFetch<HostedServerStatus>(host, '/v1/status'),
  prepare: (host: RemoteHost, body: RemotePrepareRequest) =>
    agentFetch<HostedServerStatus>(host, '/v1/prepare', { method: 'POST', body: JSON.stringify(body) }),
  start: (host: RemoteHost, body: RemoteStartRequest) =>
    agentFetch<{ started: boolean }>(host, '/v1/start', { method: 'POST', body: JSON.stringify(body) }),
  stop: (host: RemoteHost) => agentFetch<{ started: boolean }>(host, '/v1/stop', { method: 'POST' }),
  getProperties: (host: RemoteHost) => agentFetch<ServerPropertiesSummary>(host, '/v1/properties'),
  setProperties: (host: RemoteHost, summary: ServerPropertiesSummary) =>
    agentFetch<void>(host, '/v1/properties', { method: 'POST', body: JSON.stringify(summary) }),
  /** No custom headers on EventSource, so the token rides in the query string instead. */
  logsUrl: (host: RemoteHost) => `${host.url.replace(/\/+$/, '')}/v1/logs?token=${encodeURIComponent(host.token)}`,
};

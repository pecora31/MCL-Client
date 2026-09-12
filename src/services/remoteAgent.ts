// Talks to a remote MCL Agent (src-tauri/src/bin/mcl_agent.rs) via Tauri commands that make
// the actual HTTPS calls in Rust — the Tauri webview's own fetch() cannot be told to trust a
// self-signed certificate, so cert-pinned requests must originate from the Rust backend
// (see src-tauri/src/remote_agent.rs) rather than this file directly hitting the network.
import { invokeCommand } from './api';
import type { HostedServerStatus, ServerPropertiesSummary } from '../types';

export interface RemoteHost {
  id: string;
  name: string;
  /** e.g. "https://203.0.113.10:8642" — no trailing slash required. */
  url: string;
  token: string;
  /** The agent's self-signed certificate, PEM-encoded, pasted in by the operator. */
  certPem: string;
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

interface HostArg {
  url: string;
  token: string;
  certPem: string;
}

function toHostArg(host: RemoteHost): HostArg {
  return { url: host.url, token: host.token, certPem: host.certPem };
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
  status: (host: RemoteHost) => invokeCommand<HostedServerStatus>('remote_agent_status', { host: toHostArg(host) }),
  prepare: (host: RemoteHost, body: RemotePrepareRequest) =>
    invokeCommand<HostedServerStatus>('remote_agent_prepare', {
      host: toHostArg(host),
      loader: body.loader,
      gameVersion: body.gameVersion,
      loaderVersion: body.loaderVersion,
      acceptEula: body.acceptEula,
    }),
  start: (host: RemoteHost, body: RemoteStartRequest) =>
    invokeCommand<void>('remote_agent_start', { host: toHostArg(host), minRam: body.minRam, maxRam: body.maxRam }),
  stop: (host: RemoteHost) => invokeCommand<void>('remote_agent_stop', { host: toHostArg(host) }),
  getProperties: (host: RemoteHost) =>
    invokeCommand<ServerPropertiesSummary>('remote_agent_get_properties', { host: toHostArg(host) }),
  setProperties: (host: RemoteHost, summary: ServerPropertiesSummary) =>
    invokeCommand<void>('remote_agent_set_properties', { host: toHostArg(host), summary }),
  sendCommand: (host: RemoteHost, command: string) =>
    invokeCommand<void>('remote_agent_send_command', { host: toHostArg(host), command }),
  /** Uploads whatever mod jars the agent doesn't already have; returns how many were sent. */
  syncMods: (host: RemoteHost, instanceId: string) =>
    invokeCommand<number>('remote_agent_sync_mods', { host: toHostArg(host), instanceId }),
  /** Starts forwarding this host's console output as `remote-server-log` Tauri events tagged
   *  with `streamId` (pass the host's own id) — listen for that event, filter by streamId. */
  startLogStream: (host: RemoteHost, streamId: string) =>
    invokeCommand<void>('remote_agent_start_log_stream', { host: toHostArg(host), streamId }),
  stopLogStream: (streamId: string) => invokeCommand<void>('remote_agent_stop_log_stream', { streamId }),
};

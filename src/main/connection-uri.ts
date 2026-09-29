import { ConnectionString } from "mongodb-connection-string-url";
import type { Profile, Secrets } from "../shared/contracts";

export type UriExport = { uri: string; omissions: string[] };

function setOption(uri: ConnectionString, key: string, value?: string) {
  if (value === undefined || value === "") uri.searchParams.delete(key);
  else uri.searchParams.set(key, value);
}

/** Builds a portable MongoDB URI from the actual saved connection settings. */
export function exportMongoUri(
  profile: Profile,
  secrets: Secrets,
  includePassword: boolean,
): UriExport {
  const uri = new ConnectionString(profile.uri);
  uri.pathname = `/${encodeURIComponent(profile.database)}`;
  uri.username = profile.username;
  uri.password = includePassword ? secrets.password || "" : "";
  setOption(uri, "authSource", profile.authSource);
  setOption(
    uri,
    "authMechanism",
    profile.authMechanism === "DEFAULT" ? undefined : profile.authMechanism,
  );
  setOption(uri, "tls", profile.tls || profile.provider === "cosmos" ? "true" : undefined);
  uri.searchParams.delete("ssl");
  setOption(uri, "replicaSet", profile.replicaSet);
  setOption(uri, "directConnection", profile.directConnection ? "true" : undefined);
  setOption(uri, "readPreference", profile.readPreference);
  setOption(uri, "w", profile.writeConcern);
  setOption(uri, "serverSelectionTimeoutMS", String(profile.timeoutMS));
  setOption(uri, "connectTimeoutMS", String(profile.timeoutMS));
  const omissions = [
    profile.caFile && "CA certificate file",
    profile.certFile && "client certificate file",
    profile.ssh.enabled && "SSH tunnel",
  ].filter(Boolean) as string[];
  return { uri: uri.toString(), omissions };
}

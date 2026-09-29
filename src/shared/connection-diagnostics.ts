export type ConnectionDiagnostic = {
  kind: "network" | "tls" | "authentication" | "authorization" | "timeout" | "unknown";
  advice: string;
};

export function diagnoseConnectionError(error: unknown): ConnectionDiagnostic {
  const text = String(error).toLowerCase();
  if (/enotfound|eai_again|getaddrinfo|dns|econnrefused|ehostunreach/.test(text))
    return { kind: "network", advice: "Check the host name, DNS, port and network route." };
  if (/certificate|tls|ssl|hostname|altname|self signed/.test(text))
    return { kind: "tls", advice: "Check the CA certificate, client certificate and server host name." };
  if (/auth.*fail|authentication failed|sasl|bad auth/.test(text))
    return { kind: "authentication", advice: "Check the username, password, authSource and authentication mechanism." };
  if (/unauthorized|not authorized|permission denied/.test(text))
    return { kind: "authorization", advice: "The connection works, but this account lacks access to the requested database or collection." };
  if (/timed out|timeout|server selection/.test(text))
    return { kind: "timeout", advice: "The server did not respond in time. Check the route, firewall and timeout setting." };
  return { kind: "unknown", advice: "Review the connection settings and the server log for more detail." };
}

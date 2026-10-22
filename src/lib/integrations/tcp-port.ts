import { Socket } from "node:net";

/** Test only whether the configured TCP port accepts a connection. */
export function isTcpPortOpen(baseUrl: string, timeoutMs = 1200): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return Promise.resolve(false);
    host = url.hostname.replace(/^\[|\]$/g, "");
    port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(connected);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    try { socket.connect(port, host); }
    catch { finish(false); }
  });
}

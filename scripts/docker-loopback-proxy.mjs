import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";

export function forceLoopbackPorts(containerName, input) {
  if (!/^supabase_[a-z0-9_]+_chagokchan$/.test(containerName)) throw new Error("Unexpected local container");
  const result = structuredClone(input);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid container configuration");
  if (!result.HostConfig || typeof result.HostConfig !== "object") throw new Error("Invalid container host configuration");
  for (const bindings of Object.values(result.HostConfig.PortBindings ?? {})) {
    if (!Array.isArray(bindings)) throw new Error("Invalid published port");
    for (const binding of bindings) {
      if (!binding || typeof binding !== "object" || typeof binding.HostPort !== "string") throw new Error("Invalid published port");
      binding.HostIp = "127.0.0.1";
    }
  }
  return result;
}

export function assertLoopbackPorts(ports) {
  for (const bindings of Object.values(ports ?? {})) {
    for (const binding of bindings ?? []) {
      if (!["127.0.0.1", "::1"].includes(binding.HostIp)) throw new Error("Local DB published outside loopback");
    }
  }
}

export async function openLoopbackDockerBridge(endpoint) {
  if (process.platform !== "win32" || !/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint)) throw new Error("A local Windows Docker endpoint is required");
  const upstreamPipe = "\\\\.\\pipe\\" + endpoint.split("/").at(-1);
  const pipeName = "chagokchan-docker-" + randomBytes(24).toString("hex");
  const listenPipe = "\\\\.\\pipe\\" + pipeName;
  const server = http.createServer(async (request, response) => {
    try {
      const address = new URL(request.url, "http://docker.local");
      let body;
      const headers = { ...request.headers };
      if (request.method === "POST" && /^\/(?:v[\d.]+\/)?containers\/create$/.test(address.pathname)) {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) throw new Error("Container request is too large");
          chunks.push(chunk);
        }
        body = JSON.stringify(forceLoopbackPorts(address.searchParams.get("name") ?? "", JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        headers["content-length"] = String(Buffer.byteLength(body));
        delete headers["transfer-encoding"];
      }
      const upstream = http.request({ socketPath: upstreamPipe, method: request.method, path: request.url, headers }, (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Local Docker bridge failed"); });
      if (body !== undefined) upstream.end(body);
      else request.pipe(upstream);
    } catch {
      response.writeHead(400);
      response.end("Local Docker request rejected");
    }
  });
  server.on("upgrade", (request, client, head) => {
    const upstream = net.connect(upstreamPipe, () => {
      const lines = [request.method + " " + request.url + " HTTP/" + request.httpVersion];
      for (let index = 0; index < request.rawHeaders.length; index += 2) lines.push(request.rawHeaders[index] + ": " + request.rawHeaders[index + 1]);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(listenPipe, resolve); });
  return {
    endpoint: "npipe:////./pipe/" + pipeName,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}

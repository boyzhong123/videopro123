/**
 * 同源代理：前端请求 /api/proxy?url=xxx，由本接口转发到豆包/火山/TTS 等，部署后无需 corsproxy.io
 * 部署到 Vercel 时，将 api/ 目录一起部署即可提供 /api/proxy
 */
export default async function proxyHandler(req: any, res: any) {
  const url = req.query?.url;
  if (typeof url !== "string") {
    res.status(400).end("Missing url");
    return;
  }
  let target: string;
  try {
    target = decodeURIComponent(url);
  } catch {
    res.status(400).end("Invalid url");
    return;
  }
  try {
    const method = req.method || "GET";
    const headers: Record<string, string> = {};
    const h = req.headers || {};
    if (h.authorization) headers["Authorization"] = Array.isArray(h.authorization) ? h.authorization[0] : h.authorization;
    if (h["content-type"]) headers["Content-Type"] = Array.isArray(h["content-type"]) ? h["content-type"][0] : h["content-type"];
    if (h["x-api-resource-id"]) headers["X-Api-Resource-Id"] = Array.isArray(h["x-api-resource-id"]) ? h["x-api-resource-id"][0] : h["x-api-resource-id"];
    if (h["x-api-access-key"]) headers["X-Api-Access-Key"] = Array.isArray(h["x-api-access-key"]) ? h["x-api-access-key"][0] : h["x-api-access-key"];
    if (h["x-api-key"]) headers["x-api-key"] = Array.isArray(h["x-api-key"]) ? h["x-api-key"][0] : h["x-api-key"];
    const body = method === "POST" && req.body != null ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined;
    const r = await fetch(target, { method, headers, body });
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = await r.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (e) {
    res.status(502).end(String(e));
  }
}

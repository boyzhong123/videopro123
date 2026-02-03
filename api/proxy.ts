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
    if (h["x-api-app-id"]) headers["X-Api-App-Id"] = Array.isArray(h["x-api-app-id"]) ? h["x-api-app-id"][0] : h["x-api-app-id"];
    if (h["x-api-access-key"]) headers["X-Api-Access-Key"] = Array.isArray(h["x-api-access-key"]) ? h["x-api-access-key"][0] : h["x-api-access-key"];
    if (h["x-api-key"]) headers["x-api-key"] = Array.isArray(h["x-api-key"]) ? h["x-api-key"][0] : h["x-api-key"];
    if (h.connection) headers["Connection"] = Array.isArray(h.connection) ? h.connection[0] : h.connection;
    const body = method === "POST" && req.body != null ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    const r = await fetch(target, { method, headers, body, signal: controller.signal });
    clearTimeout(timeoutId);
    
    res.status(r.status);
    r.headers.forEach((v, k) => {
      const lower = String(k).toLowerCase();
      if (lower === "content-encoding" || lower === "transfer-encoding") return;
      res.setHeader(k, v);
    });
    
    // Use streaming to handle large responses more reliably
    if (!r.body) {
      res.end();
      return;
    }
    
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalLength += value.length;
        }
      }
      
      // Combine all chunks
      const combined = new Uint8Array(totalLength);
      let position = 0;
      for (const chunk of chunks) {
        combined.set(chunk, position);
        position += chunk.length;
      }
      
      console.log(`[Proxy] ${method} ${target.substring(0, 80)} -> ${r.status} (${totalLength} bytes)`);
      res.end(Buffer.from(combined));
    } catch (readError) {
      console.error(`[Proxy] Stream read error:`, readError);
      throw readError;
    }
  } catch (e) {
    console.error(`[Proxy] Request failed:`, e);
    res.status(502).end(String(e));
  }
}

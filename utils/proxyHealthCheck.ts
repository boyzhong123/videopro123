/**
 * Proxy Health Check Utility
 * Checks if the /api/proxy endpoint is accessible
 */

export interface ProxyHealthStatus {
  isHealthy: boolean;
  message: string;
  suggestion?: string;
}

/**
 * Check if the /api/proxy endpoint is accessible and working
 */
export async function checkProxyHealth(): Promise<ProxyHealthStatus> {
  try {
    // Try to access the proxy endpoint without a url parameter
    // The vite middleware returns "proxy ok" for GET /api/proxy
    const response = await fetch('/api/proxy', {
      method: 'GET',
    });

    const text = await response.text();

    if (response.ok && text.trim() === 'proxy ok') {
      return {
        isHealthy: true,
        message: '代理服务正常运行',
      };
    }

    // If we get here, the proxy exists but returned unexpected content
    return {
      isHealthy: false,
      message: '代理端点返回了意外的响应',
      suggestion: '请确认开发服务器正在运行 (npm run dev)，并且访问的是正确的地址（如 http://localhost:3000）',
    };
  } catch (error) {
    // Network error - likely the proxy endpoint doesn't exist
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      isHealthy: false,
      message: '无法访问代理端点',
      suggestion: 
        '可能的原因：\n' +
        '1. 开发服务器未运行 - 请使用 npm run dev 启动\n' +
        '2. 访问的URL不正确 - 请确认访问的是 http://localhost:3000\n' +
        '3. 端口冲突 - 可能其他程序占用了3000端口\n\n' +
        `错误详情: ${errorMessage}`,
    };
  }
}

/**
 * Get current page URL info for debugging
 */
export function getPageUrlInfo(): { origin: string; href: string } {
  if (typeof window === 'undefined') {
    return { origin: 'unknown', href: 'unknown' };
  }
  return {
    origin: window.location.origin,
    href: window.location.href,
  };
}

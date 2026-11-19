import type { Express, Request } from "express";
import type { ServerResponse } from "http";
import type { Socket } from "net";
import { createProxyMiddleware } from "http-proxy-middleware";

/**
 * Hosted deployments (Railway) serve the PHP API from a separate private service.
 * The browser must reach it on the same origin as this app so the PHP session
 * cookie (SameSite=Lax) is sent, so `/backend/*` is streamed through to PHP.
 *
 * Must be registered before any body parser: the request body is piped as-is.
 * Disabled unless PHP_INTERNAL_URL is set, so local XAMPP development is unchanged.
 */
export function registerPhpProxy(app: Express) {
  const target = process.env.PHP_INTERNAL_URL?.trim().replace(/\/+$/, "");
  if (!target) return;

  const onError = (
    _error: Error,
    _req: Request,
    res: ServerResponse | Socket
  ) => {
    if (!("writeHead" in res) || res.headersSent) {
      if ("destroy" in res) res.destroy();
      return;
    }
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "PHP_UNAVAILABLE", message: "The PHP service is unavailable." },
      })
    );
  };

  const common = {
    target,
    // Keep the browser's Host header: PHP builds photo URLs and checks them against it.
    // Railway's X-Forwarded-Proto passes through untouched (no xfwd rewriting).
    changeOrigin: false,
    xfwd: false,
    proxyTimeout: 30_000,
    timeout: 30_000,
    on: { error: onError as never },
  };

  // Express strips the mount path, so /backend/api/x reaches PHP as /api/x.
  app.use("/backend", createProxyMiddleware<Request, ServerResponse>(common));
  // Profile photos are files on the PHP service's volume. This must win over the
  // Manus storage proxy, which is not available outside Manus hosting.
  app.use(
    "/manus-storage/profile-photos",
    createProxyMiddleware<Request, ServerResponse>({
      ...common,
      pathRewrite: path => `/manus-storage/profile-photos${path}`,
    })
  );
  console.log(`[php-proxy] /backend -> ${target}`);
}

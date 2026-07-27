// Edge router: watchwithmi.tn07.dev -> two Cloud Run services, one origin.
//
// Cloud Run routes by Host header and 404s on a request claiming to be a custom
// domain, and Cloudflare's free plan cannot override the Host it sends to an
// origin. So every request is rewritten to the real *.run.app hostname here.
//
// Both services sit behind ONE public hostname on purpose. The browser then
// talks to the API same-origin, which removes cross-origin requests entirely:
// no preflights, and the Socket.IO handshake stops depending on a CORS
// allowlist that has to be kept in sync with the frontend's URL.
//
// Path ownership (verified: the Next.js app defines only / and /room, and has
// no route handlers of its own, so these prefixes cannot collide):
//   /api/*, /socket.io/*, /health  -> FastAPI + Socket.IO
//   everything else                -> Next.js SSR

const API_ORIGIN = "watchwithmi-api-974343814740.asia-south1.run.app";
const WEB_ORIGIN = "watchwithmi-web-974343814740.asia-south1.run.app";

const API_PREFIXES = ["/api/", "/socket.io/"];
const API_EXACT = ["/health"];

function isApiPath(pathname) {
  return API_EXACT.includes(pathname) || API_PREFIXES.some((p) => pathname.startsWith(p));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(url);
    target.protocol = "https:";
    target.host = isApiPath(url.pathname) ? API_ORIGIN : WEB_ORIGIN;
    target.port = "";

    // Building the Request from the rewritten URL is what sets the outbound
    // Host; a hand-set "Host" header is ignored by the runtime. The original
    // headers ride along, which is what lets a WebSocket upgrade survive:
    // fetch() returns the 101 response and we hand it straight back, so
    // Socket.IO's websocket transport works rather than falling back to
    // long-polling.
    return fetch(new Request(target, request));
  },
};

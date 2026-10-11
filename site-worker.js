// Serves the app on motopotholereporter.au (Cloudflare static assets). www forwards to the bare address.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname === "www.motopotholereporter.au") {
      url.hostname = "motopotholereporter.au";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(req);
  },
};

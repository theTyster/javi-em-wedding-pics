// Runs in front of every request — static assets and /api alike — since it
// sits at the Pages Functions root. request.cf.country is Cloudflare's edge
// geolocation (ISO 3166-1 alpha-2), set before the request reaches this code,
// so it can't be spoofed by a client header.
const ALLOWED_COUNTRY = "US";

export const onRequest: PagesFunction = async (context) => {
  const country = context.request.cf?.country;
  if (country && country !== ALLOWED_COUNTRY) {
    return new Response("This site is only available in the United States.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return context.next();
};

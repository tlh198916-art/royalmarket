export type ShareLinks = {
  x: string;
  facebook: string;
  whatsapp: string;
};

/** Share-intent URLs for the main networks. Pure — unit-tested. */
export function buildShareLinks(url: string, text: string): ShareLinks {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  };
}

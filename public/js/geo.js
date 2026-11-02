// js/geo.js — turns whatever people paste into coordinates: "10.9503, 78.6911", "10°57'01.1"N 78°41'27.9"E",
// Google Maps / Apple Maps / OpenStreetMap links, geo: URIs. Returns { lat, lng } or null.
(function (root) {
  'use strict';
  const num = '-?\\d{1,3}(?:\\.\\d+)?';
  const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const pair = (a, b) => { const lat = parseFloat(a), lng = parseFloat(b); return valid(lat, lng) ? { lat, lng } : null; };

  function dms(d, m, s, hemi) {
    let v = Math.abs(parseFloat(d)) + (parseFloat(m || 0) / 60) + (parseFloat(s || 0) / 3600);
    if (/^[SWsw]$/.test(hemi) || parseFloat(d) < 0) v = -v;
    return v;
  }

  function parseDms(text) {
    // 10°57'01.1"N 78°41'27.9"E  (also with ′ ″ or plain quotes, optional seconds)
    const re = /(-?\d{1,3})\s*[°º:\s]\s*(\d{1,2})?\s*['′:]?\s*(\d{1,2}(?:\.\d+)?)?\s*["″]?\s*([NSns])[\s,;]*(-?\d{1,3})\s*[°º:\s]\s*(\d{1,2})?\s*['′:]?\s*(\d{1,2}(?:\.\d+)?)?\s*["″]?\s*([EWew])/;
    const m = text.match(re);
    if (!m) return null;
    const lat = dms(m[1], m[2], m[3], m[4]), lng = dms(m[5], m[6], m[7], m[8]);
    return valid(lat, lng) ? { lat, lng } : null;
  }

  function fromUrl(u) {
    const s = u.href || '';
    let m;
    // Google: the dropped pin is !3d<lat>!4d<lng>; this is more exact than the map-centre "@lat,lng".
    if ((m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/))) { const r = pair(m[1], m[2]); if (r) return r; }
    for (const key of ['q', 'query', 'll', 'sll', 'center', 'destination', 'daddr', 'saddr', 'mlat']) {
      const v = u.searchParams.get(key);
      if (!v) continue;
      if (key === 'mlat') { const r = pair(v, u.searchParams.get('mlon')); if (r) return r; continue; }
      const mm = v.match(new RegExp('(' + num + ')\\s*[, ]\\s*(' + num + ')'));
      if (mm) { const r = pair(mm[1], mm[2]); if (r) return r; }
    }
    if ((m = s.match(new RegExp('/@(' + num + '),(' + num + ')')))) { const r = pair(m[1], m[2]); if (r) return r; }
    if ((m = s.match(new RegExp('#map=\\d+/(' + num + ')/(' + num + ')')))) { const r = pair(m[1], m[2]); if (r) return r; }
    if ((m = decodeURIComponent(s).match(new RegExp('(' + num + ')\\s*,\\s*(' + num + ')')))) { const r = pair(m[1], m[2]); if (r) return r; }
    return null;
  }

  function parse(text) {
    if (!text) return null;
    let t = String(text).trim();
    // geo:10.95,78.69?z=17
    let m = t.match(new RegExp('^geo:(' + num + '),(' + num + ')', 'i'));
    if (m) return pair(m[1], m[2]);
    // A link anywhere inside the pasted text (people often paste "Location: https://…").
    const url = t.match(/https?:\/\/[^\s<>"']+/i);
    if (url) {
      try { const r = fromUrl(new URL(url[0])); if (r) return r; } catch (e) { /* not a URL */ }
      return null; // a link without readable coordinates (e.g. short link) — caller may resolve it
    }
    const d = parseDms(t);
    if (d) return d;
    // "10.9503, 78.6911" | "10.9503 78.6911" | "10.9503N 78.6911E" | "lat 10.9 lng 78.6"
    m = t.match(new RegExp('(' + num + ')\\s*°?\\s*([NSns])?\\s*[,;\\s]\\s*(' + num + ')\\s*°?\\s*([EWew])?'));
    if (m) {
      let lat = parseFloat(m[1]), lng = parseFloat(m[3]);
      if (/^[Ss]$/.test(m[2] || '')) lat = -Math.abs(lat);
      if (/^[Ww]$/.test(m[4] || '')) lng = -Math.abs(lng);
      if (valid(lat, lng)) return { lat, lng };
    }
    return null;
  }

  // Is this a map link we could ask the server to expand (short links)?
  function isShortMapLink(text) {
    const u = (String(text).match(/https?:\/\/[^\s<>"']+/i) || [])[0];
    if (!u) return false;
    try { const h = new URL(u).hostname; return /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i.test(h) || /(^|\.)google\.[a-z.]+$/i.test(h) || /(^|\.)(openstreetmap\.org|osm\.org)$/i.test(h); } catch (e) { return false; }
  }

  const api = { parse, isShortMapLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HSGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);

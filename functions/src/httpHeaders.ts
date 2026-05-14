/**
 * Shared HTTP headers for outbound fetches.
 *
 * Centralized so the User-Agent and browser-like header set can evolve in
 * one place. Two presets:
 *
 *   GOOGLE_PATENTS_HEADERS — realistic Chrome fingerprint for the
 *     undocumented patents.google.com/xhr/result endpoint. The previous
 *     "PatentSearchBot/1.0" UA was self-identifying and triggered
 *     aggressive throttling.
 *
 *   SCHOLARLY_API_HEADERS — polite UA with contact email per the
 *     CrossRef convention (AppName/version (mailto:email)). CrossRef
 *     routes such clients into its "polite pool" with priority over
 *     anonymous traffic. Semantic Scholar accepts the same format.
 */

export const GOOGLE_PATENTS_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://patents.google.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Ch-Ua":
    "\"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"",
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": "\"Windows\"",
};

export const SCHOLARLY_API_HEADERS: Record<string, string> = {
  "User-Agent":
    "AIPatentSearchGenerator/1.0 (mailto:smythmyke@gmail.com)",
  "Accept": "application/json",
};

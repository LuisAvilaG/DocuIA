import { createHmac, randomBytes } from "node:crypto";

export interface NSCredentials {
  accountId:      string;
  consumerKey:    string;
  consumerSecret: string;
  tokenId:        string;
  tokenSecret:    string;
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

function nonce(): string {
  return randomBytes(16).toString("hex");
}

function timestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

/**
 * Builds an OAuth 1.0a Authorization header for NetSuite TBA (HMAC-SHA256).
 */
export function buildOAuthHeader(
  url: string,
  method: string,
  creds: NSCredentials,
): string {
  const ts    = timestamp();
  const nc    = nonce();
  const realm = creds.accountId;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     creds.consumerKey,
    oauth_nonce:            nc,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp:        ts,
    oauth_token:            creds.tokenId,
    oauth_version:          "1.0",
  };

  // Parse URL to separate base + query params
  const urlObj      = new URL(url);
  const baseUrl     = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const queryParams: Record<string, string> = {};
  urlObj.searchParams.forEach((val, key) => { queryParams[key] = val; });

  // Merge all params for signature base string
  const allParams: Record<string, string> = { ...queryParams, ...oauthParams };

  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.tokenSecret)}`;

  const signature = createHmac("sha256", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const headerString = Object.keys(headerParams)
    .map(k => `${k}="${percentEncode(headerParams[k])}"`)
    .join(", ");

  return `OAuth realm="${realm}", ${headerString}`;
}

/**
 * Builds the NetSuite restlet URL for the given environment.
 * Sandbox account IDs typically end in _SB1.
 */
export function buildRestletUrl(
  accountId: string,
  scriptId:  string,
  deployId:  string,
): string {
  const normalizedId = accountId.replace(/_/g, "-").toLowerCase();
  const host         = `${normalizedId}.restlets.api.netsuite.com`;
  return `https://${host}/app/site/hosting/restlet.nl?script=${scriptId}&deploy=${deployId}`;
}

/**
 * Builds the NetSuite REST API base URL (for credential testing — no scripts needed).
 */
export function buildRestApiUrl(accountId: string): string {
  const normalizedId = accountId.replace(/_/g, "-").toLowerCase();
  return `https://${normalizedId}.suitetalk.api.netsuite.com/services/rest/record/v1`;
}

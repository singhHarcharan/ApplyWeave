const blocked = ['linkedin.com', 'wellfound.com'];
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return blocked.some(domain => host === domain || host.endsWith('.' + domain));
}
export function isAllowedUrl(url: string, approvedHosts: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1') return false;
    if (isBlockedHost(host)) return false;
    return approvedHosts.some(item => item.toLowerCase() === host);
  } catch { return false; }
}

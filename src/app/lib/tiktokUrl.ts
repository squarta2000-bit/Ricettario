export function isTiktokUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|m\.tiktok\.com)\//i.test(url)
}

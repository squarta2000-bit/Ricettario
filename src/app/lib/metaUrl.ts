export function isInstagramOrFacebookUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(instagram\.com|facebook\.com|fb\.watch)\//i.test(url)
}

export function getPublicUrl(url: string): string {
  if (url.charAt(0) != "/") {
    url = "/" + url;
  }
  return "/app" + url;
}

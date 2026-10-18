/** Asset hash in an image URL or an asset:// reference. Kept independent of the browser picker. */
export function assetHashOf(url: string): string | undefined {
  return /assets\/([0-9a-f]{16,})/.exec(url)?.[1] ?? (url.startsWith("asset://") ? url.slice(8) : undefined);
}

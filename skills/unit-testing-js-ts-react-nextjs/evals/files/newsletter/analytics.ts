export function track(event: string, props: Record<string, unknown>): void {
  (window as unknown as { dataLayer?: unknown[] }).dataLayer?.push({ event, ...props });
}

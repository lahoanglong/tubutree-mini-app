// Next gọi register() một lần khi server khởi động.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    const { startServerSentry } = await import('./lib/sentry-server');
    startServerSentry();
  }
}

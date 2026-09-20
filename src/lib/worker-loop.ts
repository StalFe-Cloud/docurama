export function startWorkerLoop(
  tick: () => Promise<void>,
  options: { initialDelayMs: number; intervalMs: number; onError?: (error: unknown) => void },
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => { void run(); }, delay);
    timer.unref?.();
  };
  const run = async () => {
    try { await tick(); }
    catch (error) { options.onError?.(error); }
    finally { schedule(options.intervalMs); }
  };
  schedule(options.initialDelayMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

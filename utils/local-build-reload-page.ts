export type StopLocalBuildReload = () => void;

export function startLocalBuildReloadForPage(
  start: () => StopLocalBuildReload | Promise<StopLocalBuildReload>,
): StopLocalBuildReload {
  let closed = false;
  let stop: StopLocalBuildReload | null = null;

  void Promise.resolve()
    .then(start)
    .then((candidate) => {
      if (closed) {
        candidate();
        return;
      }
      stop = candidate;
    })
    .catch(() => {});

  return () => {
    closed = true;
    stop?.();
    stop = null;
  };
}

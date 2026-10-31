/**
 * A file that stops the worker, skipped after it has done so twice.
 *
 * One bad file already fails alone: sync-knowledge catches a file's error,
 * lists it as unread and goes on. What it can't catch is the worker
 * process dying on a file (out of memory, a native crash). The run is
 * retried, finished files are kept, and the retry reaches the same file
 * and dies again; every later run would too. Queue systems call this a
 * poison message and set it aside after a few attempts. This does the
 * same per file.
 *
 * How a death is seen: sync-knowledge marks the file it is on ("in
 * flight") before reading it and clears the mark when its loop ends; the
 * worker also clears it in its `finally`, so any ending that runs
 * JavaScript, success, error or Stop, leaves nothing behind. Only a dead
 * process leaves a mark, and the next pass on that project counts it as a
 * strike against that file. Keyed by file and content hash, so a
 * replaced file starts clean, and strikes expire, so a skipped file gets
 * another try after a month.
 */

/** Deaths on one file before it is skipped. One could be bad luck (a
 * deploy, a neighbour's job using the memory); two on the same file is
 * the file. */
export const STRIKES_TO_SKIP = 2;
/** A mark older than this is from no run that is coming back. */
const IN_FLIGHT_TTL_MS = 24 * 60 * 60 * 1000;
const STRIKE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The few Redis calls this needs; ioredis fits it, and so does a test's map. */
export type PoisonFileStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ms: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
};

/** A file as the guard knows it: its id and the hash of its content. */
export function poisonFileKey(fileId: string, hash: string): string {
  return `${fileId}:${hash}`;
}

export function poisonFiles(store: PoisonFileStore, projectFolderId: string) {
  const inFlightKey = `graphlog:in-flight:${projectFolderId}`;
  const strikesKey = (file: string) => `graphlog:file-strikes:${file}`;
  return {
    /** At the start of a pass: the file the last pass died on, if any,
     * with its strikes counted. */
    async countLeftInFlight(): Promise<{ file: string; strikes: number } | null> {
      const file = await store.get(inFlightKey);
      if (!file) return null;
      const strikes = await store.incr(strikesKey(file));
      await store.pexpire(strikesKey(file), STRIKE_TTL_MS);
      await store.del(inFlightKey);
      return { file, strikes };
    },
    async strikes(file: string): Promise<number> {
      return Number(await store.get(strikesKey(file))) || 0;
    },
    async start(file: string): Promise<void> {
      await store.set(inFlightKey, file, "PX", IN_FLIGHT_TTL_MS);
    },
    async finish(): Promise<void> {
      await store.del(inFlightKey);
    },
  };
}

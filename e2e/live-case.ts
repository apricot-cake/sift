import type { RunnerTask } from "vitest";
import type { LiveSession } from "./live.ts";

export interface LiveCase {
  id: string;
  entry: string;
  run(session: LiveSession, task: RunnerTask): Promise<void>;
}

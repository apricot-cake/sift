// ポップアップとショートカットがタイムラインの content script へ渡す操作。
// どちらも同じ意味のメッセージを使うので、入口が増えてもページ側の状態遷移は
// 1つに保てる。
export const TIMELINE_CONTROL = {
  getState: "sift:timeline-get-state",
  toggleFiltering: "sift:timeline-toggle-filtering",
  toggleShowAll: "sift:timeline-toggle-show-all",
} as const;

export type TimelineControlMessage =
  (typeof TIMELINE_CONTROL)[keyof typeof TIMELINE_CONTROL];

export interface TimelineControlRequest {
  readonly type: TimelineControlMessage;
}

export interface TimelineControlState {
  readonly timelineAvailable: boolean;
  readonly filteringEnabled: boolean;
  readonly showAllTemporarily: boolean;
}

export function isTimelineControlState(
  value: unknown,
): value is TimelineControlState {
  return (
    typeof value === "object" &&
    value !== null &&
    "timelineAvailable" in value &&
    "filteringEnabled" in value &&
    "showAllTemporarily" in value &&
    typeof (value as TimelineControlState).timelineAvailable === "boolean" &&
    typeof (value as TimelineControlState).filteringEnabled === "boolean" &&
    typeof (value as TimelineControlState).showAllTemporarily === "boolean"
  );
}

export function isTimelineControlRequest(
  value: unknown,
): value is TimelineControlRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    Object.values(TIMELINE_CONTROL).includes(
      (value as { type?: unknown }).type as TimelineControlMessage,
    )
  );
}

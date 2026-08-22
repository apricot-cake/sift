// ショートカットがタイムラインの content script へ渡す操作。ポップアップは
// 保存済みの設定を直接切り替えるため、content script の起動状態に依存しない。
export const TIMELINE_CONTROL = {
  setFiltering: "sift:timeline-set-filtering",
} as const;

export type TimelineControlMessage =
  (typeof TIMELINE_CONTROL)[keyof typeof TIMELINE_CONTROL];

export interface TimelineControlRequest {
  readonly type: TimelineControlMessage;
  readonly enabled?: boolean;
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
    ) &&
    ((value as { type?: unknown }).type !== TIMELINE_CONTROL.setFiltering ||
      typeof (value as { enabled?: unknown }).enabled === "boolean")
  );
}

import type { ExportSegment, ExportTranscriptData, ExportType } from "../types/ipc";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

export function formatSrtTimestamp(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const totalMilliseconds = Math.floor(safe * 1000);

  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const remainingAfterHours = totalMilliseconds % 3_600_000;
  const minutes = Math.floor(remainingAfterHours / 60_000);
  const remainingAfterMinutes = remainingAfterHours % 60_000;
  const seconds = Math.floor(remainingAfterMinutes / 1000);
  const milliseconds = remainingAfterMinutes % 1000;

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(milliseconds)}`;
}

export function buildSrt(segments: ExportSegment[]): string {
  const spokenSegments = segments.filter((segment) => (segment.text ?? "").trim().length > 0);

  return spokenSegments
    .map((segment, index) => {
      const lineNumber = index + 1;
      const startSeconds = Number.isFinite(segment.start) ? Math.max(0, segment.start) : 0;
      const endSecondsRaw = Number.isFinite(segment.end) ? Math.max(0, segment.end) : startSeconds;
      const endSeconds = endSecondsRaw > startSeconds ? endSecondsRaw : startSeconds + 0.05;
      const start = formatSrtTimestamp(startSeconds);
      const end = formatSrtTimestamp(endSeconds);
      const text = segment.text ?? "";
      return `${lineNumber}\n${start} --> ${end}\n${text}`;
    })
    .join("\n\n");
}

export function buildJson(data: ExportTranscriptData): string {
  return JSON.stringify(
    {
      metadata: data.metadata,
      text: data.text,
      segments: data.segments,
    },
    null,
    2
  );
}

export function buildExportContent(type: ExportType, data: ExportTranscriptData): string {
  if (type === "txt") {
    return data.text;
  }
  if (type === "srt") {
    return buildSrt(data.segments);
  }
  return buildJson(data);
}

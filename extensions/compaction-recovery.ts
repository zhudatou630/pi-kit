import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STREAM_READ_ERROR = /\bstream[_ ]read[_ ]error\b/i;

type InterruptedTurn = {
  stopReason: "error" | "length";
  error?: "stream_read_error";
};

export default function compactionRecovery(pi: ExtensionAPI): void {
  let interruptedTurn: InterruptedTurn | null = null;
  let resumeAfterCompaction: InterruptedTurn | null = null;

  pi.on("session_start", () => {
    interruptedTurn = null;
    resumeAfterCompaction = null;
  });

  pi.on("message_end", (event) => {
    const message = event.message;
    if (message.role !== "assistant") return;

    if (
      message.stopReason === "error" &&
      STREAM_READ_ERROR.test(message.errorMessage ?? "")
    ) {
      interruptedTurn = {
        stopReason: "error",
        error: "stream_read_error",
      };
      if (/network.?error/i.test(message.errorMessage ?? "")) return;
      return {
        message: {
          ...message,
          errorMessage: `network error: ${message.errorMessage}`,
        },
      };
    }

    if (message.stopReason === "length") {
      interruptedTurn = { stopReason: "length" };
      return;
    }

    interruptedTurn = null;
  });

  pi.on("session_before_compact", (event) => {
    resumeAfterCompaction =
      event.reason === "threshold" && !event.willRetry && interruptedTurn
        ? interruptedTurn
        : null;
  });

  pi.on("session_compact", (event, ctx) => {
    if (
      event.reason !== "threshold" ||
      event.willRetry ||
      !resumeAfterCompaction
    ) {
      resumeAfterCompaction = null;
      return;
    }

    const recovery = resumeAfterCompaction;
    interruptedTurn = null;
    resumeAfterCompaction = null;

    const message = {
      customType: "compaction-recovery",
      content:
        "The preceding agent turn ended before the task was complete. " +
        "Context compaction has succeeded. Resume the interrupted task from " +
        "the persisted session state, verify the latest tool result first, " +
        "and do not repeat completed side effects. A newer user message, if " +
        "present, remains the latest direction.",
      display: false,
      details: {
        version: 1,
        compactReason: event.reason,
        interruptedStopReason: recovery.stopReason,
        interruptedError: recovery.error,
      },
    };

    if (ctx.isIdle()) {
      pi.sendMessage(message, { deliverAs: "nextTurn" });
    } else {
      pi.sendMessage(message, {
        triggerTurn: true,
        deliverAs: "followUp",
      });
    }
  });
}
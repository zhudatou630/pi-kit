import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 两段职责:
// A. 把 stream_read_error 改写成 "network error: ...",让 pi 核心的自动重试识别它
//    (核心可重试正则不含 stream_read_error;若核心日后加入,可删除 A 段)。
// B. 阈值压缩(willRetry=false)后,若上一轮因 error/length 中断,则补一条续跑提示。
//    核心已自行处理"上下文溢出"和"提前 length"(output < maxTokens)的 compact-and-retry,
//    这里只兜底核心不管的:重试耗尽的 error,以及输出打满 maxTokens 的 length。
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

  pi.on("message_end", (event, ctx) => {
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
      // 提前 length 由核心 compact-and-retry 处理;模型未知时保守视为中断。
      const model = ctx.model;
      const knownModel =
        model?.provider === message.provider && model.id === message.model;
      const earlyLength =
        knownModel && model.maxTokens > 0 && message.usage.output < model.maxTokens;
      interruptedTurn = earlyLength ? null : { stopReason: "length" };
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
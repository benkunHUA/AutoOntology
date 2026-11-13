/**
 * 事件渲染器：SessionEvent → 终端输出。
 * TUI 化（Ink）时替换本文件即可，core 无需改动。
 */
import type { SessionEvent } from "@ao/protocol";

const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

export function createRenderer(): {
  render(event: SessionEvent): void;
  endLine(): void;
} {
  let streaming = false;

  const finishLine = () => {
    if (streaming) {
      process.stdout.write("\n");
      streaming = false;
    }
  };

  return {
    render(event) {
      switch (event.type) {
        case "turn_started":
          finishLine();
          break;

        case "text_delta":
          streaming = true;
          process.stdout.write(event.delta);
          break;

        case "reasoning_delta":
          // 骨架阶段不渲染推理增量（M2 加 --verbose 开关）
          break;

        case "tool_started":
          finishLine();
          process.stdout.write(
            DIM(`  ⟶ ${event.name} ${truncate(event.args, 120)}`) + "\n",
          );
          break;

        case "tool_finished":
          process.stdout.write(
            DIM(
              `  ${event.ok ? "✓" : "✗"} ${event.name} (${event.durationMs}ms) ` +
                `${truncate(event.output.split("\n")[0] ?? "", 100)}`,
            ) + "\n",
          );
          break;

        case "turn_completed":
          finishLine();
          process.stdout.write(
            DIM(
              `  ── ${event.durationMs}ms · 首字 ${
                event.firstTokenMs ?? "-"
              }ms · 工具 ${event.toolCalls} 次 · tokens ${event.usage.inputTokens}+${event.usage.outputTokens}\n`,
            ),
          );
          break;

        case "turn_aborted":
          finishLine();
          process.stdout.write(RED(`  ── 回合已中断 (${event.reason})\n`));
          break;

        case "turn_error":
          finishLine();
          process.stdout.write(RED(`  ── 回合出错: ${event.message}\n`));
          break;

        case "item_started":
          break;
      }
    },
    endLine: finishLine,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

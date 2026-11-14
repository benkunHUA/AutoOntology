import type { ToolHandler } from "@ao/protocol";
import { execCommand } from "./exec-command.ts";
import { listDir } from "./list-dir.ts";
import { readFile } from "./read-file.ts";
import { writeFile } from "./write-file.ts";

export { execCommand, listDir, readFile, writeFile };

/** 默认工具集。 */
export function defaultTools(): ToolHandler[] {
  return [execCommand, readFile, writeFile, listDir];
}

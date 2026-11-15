/**
 * SKILL.md frontmatter 解析器。
 *
 * 提取 name / description / short-description，执行 name 与
 * description 必填校验，并将 name 截断到 64 字符；
 * 解析失败抛 FrontmatterError，由发现层记录为 warning。
 */
import { MAX_SKILL_NAME_CHARS } from "./limits.ts";

export interface SkillFrontmatter {
  name: string;
  description: string;
  shortDescription?: string;
}

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export function parseFrontmatter(
  markdown: string,
  defaultName = "",
): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) throw new FrontmatterError("missing YAML frontmatter");
  const fields = parseSimpleYaml(match[1]);
  const name = (fields.name ?? defaultName).slice(0, MAX_SKILL_NAME_CHARS);
  if (!name) throw new FrontmatterError("missing name");
  if (!fields.description) throw new FrontmatterError("missing description");
  return {
    name,
    description: fields.description,
    shortDescription: fields["short-description"],
  };
}

export function parseSimpleYaml(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return fields;
}

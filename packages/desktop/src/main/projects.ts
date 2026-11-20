import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ProjectInfo } from "../shared/ipc.ts";

const DEFAULT_PROJECTS: ProjectInfo[] = [];

export class ProjectStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = resolve(userDataPath, "projects.json");
  }

  async list(): Promise<ProjectInfo[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("projects must be an array");
      return parsed
        .filter((item): item is ProjectInfo => {
          if (!item || typeof item !== "object") return false;
          const candidate = item as Partial<ProjectInfo>;
          return (
            typeof candidate.path === "string" &&
            typeof candidate.name === "string"
          );
        })
        .map((item) => ({
          name: item.name || basename(item.path),
          path: resolve(item.path),
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const seeded = await this.seedDefaults();
        await this.save(seeded);
        return seeded;
      }
      return [...DEFAULT_PROJECTS];
    }
  }

  async add(path: string): Promise<ProjectInfo[]> {
    const projects = await this.list();
    const normalized = resolve(path);
    if (projects.some((project) => project.path === normalized)) {
      return projects;
    }
    projects.unshift({
      name: basename(normalized) || normalized,
      path: normalized,
    });
    await this.save(projects);
    return projects;
  }

  async remove(path: string): Promise<ProjectInfo[]> {
    const projects = await this.list();
    const normalized = resolve(path);
    const next = projects.filter((project) => project.path !== normalized);
    await this.save(next);
    return next;
  }

  private async seedDefaults(): Promise<ProjectInfo[]> {
    const seedPath =
      process.env.INIT_CWD ?? process.env.AO_DEFAULT_PROJECT ?? process.cwd();
    try {
      const root = resolve(seedPath);
      await readFile(resolve(root, "package.json"), "utf8");
      return [{ name: basename(root) || root, path: root }];
    } catch {
      return [];
    }
  }

  private async save(projects: ProjectInfo[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify(projects, null, 2)}\n`,
      "utf8",
    );
  }
}

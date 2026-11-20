import { Folder, PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import type { ProjectInfo } from "../../../shared/ipc";

interface SidebarProps {
  projects: ProjectInfo[];
  activePath: string | null;
  collapsed: boolean;
  onToggle(): void;
  onSelect(project: ProjectInfo): void;
  onAdd(): void;
  onRemove(project: ProjectInfo): void;
}

export function Sidebar({
  projects,
  activePath,
  collapsed,
  onToggle,
  onSelect,
  onAdd,
  onRemove,
}: SidebarProps): React.JSX.Element {
  if (collapsed) {
    return (
      <aside className="rail left-rail">
        <button
          className="icon-button rail-toggle"
          onClick={onToggle}
          title="展开项目列表"
          aria-label="展开项目列表"
        >
          <PanelLeftOpen size={18} />
        </button>
        <button
          className="icon-button"
          onClick={onAdd}
          title="打开项目"
          aria-label="打开项目"
        >
          <Plus size={18} />
        </button>
        <div className="rail-projects">
          {projects.map((project) => (
            <button
              key={project.path}
              className={`project-pin ${project.path === activePath ? "active" : ""}`}
              onClick={() => onSelect(project)}
              title={project.name}
            >
              {project.name.slice(0, 1).toUpperCase() || "A"}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar left-sidebar">
      <div className="panel-header">
        <span>项目</span>
        <button
          className="icon-button"
          onClick={onToggle}
          title="收起项目列表"
          aria-label="收起项目列表"
        >
          <PanelLeftClose size={17} />
        </button>
      </div>
      <button className="add-project" onClick={onAdd}>
        <Plus size={15} />
        打开项目
      </button>
      <div className="project-list">
        {projects.map((project) => (
          <div
            key={project.path}
            className={`project-row ${project.path === activePath ? "active" : ""}`}
            onClick={() => onSelect(project)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSelect(project);
            }}
          >
            <Folder size={15} className="project-icon" />
            <div className="project-copy">
              <span className="project-name">{project.name}</span>
              <span className="project-path">{project.path}</span>
            </div>
            <button
              className="icon-button subtle"
              title="移除项目"
              aria-label="移除项目"
              onClick={(event) => {
                event.stopPropagation();
                void onRemove(project);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {projects.length === 0 && (
          <div className="panel-empty">打开一个文件夹开始</div>
        )}
      </div>
    </aside>
  );
}

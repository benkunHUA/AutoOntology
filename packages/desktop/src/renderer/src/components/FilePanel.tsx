import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FileNode, FilePreview } from "../../../shared/ipc";
import { CodeEditor } from "./CodeEditor";

interface FilePanelProps {
  collapsed: boolean;
  tab: "files" | "preview";
  tree: FileNode | null;
  selectedFile: string | null;
  preview: FilePreview | null;
  onToggle(): void;
  onTabChange(tab: "files" | "preview"): void;
  onSelect(path: string): void;
  onBack(): void;
}

export function FilePanel({
  collapsed,
  tab,
  tree,
  selectedFile,
  preview,
  onToggle,
  onTabChange,
  onSelect,
  onBack,
}: FilePanelProps): React.JSX.Element {
  if (collapsed) {
    return (
      <aside className="rail right-rail">
        <button
          className="icon-button rail-toggle"
          onClick={onToggle}
          title="展开文件树"
          aria-label="展开文件树"
        >
          <PanelRightOpen size={18} />
        </button>
        <button
          className="icon-button"
          onClick={() => onTabChange("files")}
          title="文件"
          aria-label="文件"
        >
          <Folder size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="panel right-panel">
      <div className="panel-header">
        <div className="tab-bar">
          <button
            className={`tab ${tab === "files" ? "active" : ""}`}
            onClick={() => onTabChange("files")}
          >
            文件
          </button>
          <button
            className={`tab ${tab === "preview" ? "active" : ""}`}
            onClick={() => onTabChange("preview")}
          >
            预览
          </button>
        </div>
        <button
          className="icon-button"
          onClick={onToggle}
          title="收起文件树"
          aria-label="收起文件树"
        >
          <PanelRightClose size={17} />
        </button>
      </div>

      {tab === "files" ? (
        <div className="file-tree-scroll">
          {tree ? (
            <TreeView root={tree} selectedFile={selectedFile} onSelect={onSelect} />
          ) : (
            <div className="panel-empty">选择项目后显示文件</div>
          )}
        </div>
      ) : (
        <PreviewView
          selectedFile={selectedFile}
          preview={preview}
          onBack={onBack}
        />
      )}
    </aside>
  );
}

function TreeView({
  root,
  selectedFile,
  onSelect,
}: {
  root: FileNode;
  selectedFile: string | null;
  onSelect(path: string): void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root.path]));

  useEffect(() => {
    const firstLevel = (root.children ?? [])
      .filter((node) => node.type === "directory")
      .map((node) => node.path);
    setExpanded(new Set([root.path, ...firstLevel]));
  }, [root]);

  return (
    <div className="file-tree">
      <div className="tree-root">
        <FolderOpen size={14} />
        <span className="tree-label">{root.name}</span>
      </div>
      {root.children?.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selectedFile={selectedFile}
          onToggle={setExpanded}
          onSelect={onSelect}
        />
      ))}
      {root.truncated && <div className="tree-note">目录过大，已截断</div>}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  selectedFile,
  onToggle,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  selectedFile: string | null;
  onToggle(updater: (current: Set<string>) => Set<string>): void;
  onSelect(path: string): void;
}): React.JSX.Element {
  const isDirectory = node.type === "directory";
  const isExpanded = expanded.has(node.path);

  const toggle = (): void => {
    onToggle((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  };

  return (
    <div className="tree-node">
      <button
        className={`tree-row ${isDirectory ? "directory" : "file"} ${
          node.path === selectedFile ? "selected" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDirectory ? toggle() : onSelect(node.path))}
        title={node.path}
      >
        {isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown size={13} className="tree-chevron" />
            ) : (
              <ChevronRight size={13} className="tree-chevron" />
            )}
            {isExpanded ? (
              <FolderOpen size={14} className="tree-icon" />
            ) : (
              <Folder size={14} className="tree-icon" />
            )}
          </>
        ) : (
          <>
            <span className="tree-chevron" />
            {isCodeFile(node.name) ? (
              <FileCode2 size={14} className="tree-icon" />
            ) : (
              <File size={14} className="tree-icon" />
            )}
          </>
        )}
        <span className="tree-label">{node.name}</span>
      </button>
      {isDirectory &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedFile={selectedFile}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function PreviewView({
  selectedFile,
  preview,
  onBack,
}: {
  selectedFile: string | null;
  preview: FilePreview | null;
  onBack(): void;
}): React.JSX.Element {
  if (!selectedFile || !preview) {
    return (
      <div className="preview-empty">
        <File size={22} />
        <span>选中文件后在此预览</span>
      </div>
    );
  }

  if (preview.binary) {
    return (
      <div className="preview-empty">
        <File size={22} />
        <span>二进制文件不支持预览</span>
      </div>
    );
  }

  if (preview.truncated && preview.content === "") {
    return (
      <div className="preview-empty">
        <File size={22} />
        <span>文件过大，无法预览</span>
      </div>
    );
  }

  const fileName = selectedFile.split("/").pop() ?? selectedFile;

  return (
    <div className="preview">
      <div className="preview-header">
        <button className="icon-button" onClick={onBack} title="返回文件树">
          <X size={15} />
        </button>
        <span className="preview-name">{fileName}</span>
        <span className="preview-size">{formatBytes(preview.size)}</span>
      </div>
      {isCodeFile(fileName) ? (
        <CodeEditor
          path={preview.path}
          language={languageFromName(fileName)}
          value={preview.content}
          truncated={preview.truncated}
        />
      ) : (
        <pre className="preview-content">{preview.content}</pre>
      )}
    </div>
  );
}

function isCodeFile(name: string): boolean {
  return /\.(ts|tsx|js|jsx|json|css|scss|html|md|py|rs|go|java|rb|sh|yaml|yml|toml)$/.test(
    name,
  );
}

function languageFromName(name: string): string | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    htm: "html",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    sh: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "plaintext",
  };
  return languages[extension] ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

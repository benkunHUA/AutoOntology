import Editor, { type BeforeMount } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";

interface CodeEditorProps {
  path: string;
  language: string | null;
  value: string;
  truncated: boolean;
}

const editorOptions = {
  readOnly: true,
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily:
    '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
  fontLigatures: true,
  lineHeight: 20,
  lineNumbers: "on",
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
  smoothScrolling: true,
  cursorBlinking: "solid",
  renderWhitespace: "selection",
  folding: true,
  links: true,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  occurrencesHighlight: "off",
  renderLineHighlight: "none",
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
  },
} as const;

export function CodeEditor({
  path,
  language,
  value,
  truncated,
}: CodeEditorProps): React.JSX.Element {
  return (
    <div className="code-editor">
      <Editor
        height="100%"
        path={path}
        language={language ?? "plaintext"}
        value={value}
        theme="ao-dark"
        beforeMount={defineTheme}
        options={editorOptions}
        loading={<div className="editor-loading">加载编辑器…</div>}
      />
      {truncated && <div className="preview-truncated">文件内容已截断</div>}
    </div>
  );
}

const defineTheme: BeforeMount = (monaco: Monaco) => {
  monaco.editor.defineTheme("ao-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "808080", fontStyle: "italic" },
      { token: "string", foreground: "87ff87" },
      { token: "keyword", foreground: "5fafff" },
      { token: "type", foreground: "5fd7ff" },
      { token: "type.identifier", foreground: "5fd7ff" },
      { token: "number", foreground: "af87ff" },
      { token: "delimiter", foreground: "bcbcbc" },
      { token: "operator", foreground: "bcbcbc" },
      { token: "identifier", foreground: "d0d0d0" },
    ],
    colors: {
      "editor.background": "#0d1017",
      "editor.foreground": "#d0d0d0",
      "editorLineNumber.foreground": "#3b4354",
      "editorLineNumber.activeForeground": "#8b94a7",
      "editorCursor.foreground": "#63a8f8",
      "editor.selectionBackground": "#2c3d5c",
      "editor.inactiveSelectionBackground": "#223049",
      "editor.lineHighlightBackground": "#10141c",
      "editorIndentGuide.background1": "#1a202d",
      "editorIndentGuide.activeBackground1": "#2a3140",
      "editorWidget.background": "#171c27",
      "editorWidget.border": "#252c3b",
      "scrollbarSlider.background": "#2a3140",
      "scrollbarSlider.hoverBackground": "#394154",
      "scrollbarSlider.activeBackground": "#46536b",
      "editorGutter.background": "#0d1017",
    },
  });
};

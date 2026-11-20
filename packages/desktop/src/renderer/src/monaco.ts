/// <reference types="vite/client" />

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/basic-languages/monaco.contribution";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    return new EditorWorker();
  },
};

loader.config({ monaco });

export { monaco };

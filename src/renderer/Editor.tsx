import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/language/json/monaco.contribution.js";
import "monaco-editor/language/typescript/monaco.contribution.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { queryKeyIntent } from "./query-editing";
import {
  mongoSuggestions,
  type CompletionContext,
} from "../shared/exploration";
import { useUi } from "./ui";
(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    return label === "json"
      ? new JsonWorker()
      : ["typescript", "javascript"].includes(label)
        ? new TsWorker()
        : new EditorWorker();
  },
};
loader.config({ monaco });
const mongoJsonLanguage = "mongo-json";
monaco.languages.register({ id: mongoJsonLanguage });
monaco.languages.setMonarchTokensProvider(mongoJsonLanguage, {
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"(?:\\.|[^"\\])*"/, "string"],
      [
        /(ObjectId|Long|Decimal128|ISODate|Binary|UUID|Timestamp|RegExp)(?=\s*\()/,
        "type.identifier",
      ],
      [/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, "number"],
      [/\b(?:true|false|null|undefined)\b/, "keyword"],
      [/[{}\[\],:]/, "delimiter"],
      [/[A-Za-z_$][\w$]*/, "identifier"],
      [/\s+/, "white"],
    ],
  },
});
monaco.languages.setLanguageConfiguration(mongoJsonLanguage, {
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
});

export function CodeEditor({
  value,
  onChange,
  language = "json",
  theme,
  height = "200px",
  readOnly = false,
  defaultExpandedDepth,
  defaultExpandedLines,
  onReady,
  onSelectionChange,
  completionContext,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  theme: string;
  height?: string;
  readOnly?: boolean;
  defaultExpandedDepth?: number;
  defaultExpandedLines?: number[];
  onReady?: (editor: editor.IStandaloneCodeEditor) => void;
  onSelectionChange?: (selectedText: string) => void;
  completionContext?: CompletionContext;
}) {
  const {
    editorFontFamily,
    fontSize,
    tabWidth,
    editorLineHeight,
    editorPadding,
  } = useUi();
  const editorRef = useRef<editor.IStandaloneCodeEditor | undefined>(undefined);
  const foldingRun = useRef(0);
  const context = useRef(completionContext);
  context.current = completionContext;
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  const disposables = useRef<monaco.IDisposable[]>([]);
  const selectionDisposable = useRef<monaco.IDisposable | undefined>(undefined);
  const keyboardDisposable = useRef<monaco.IDisposable | undefined>(undefined);
  const applyDefaultFolding = (
    instance: editor.IStandaloneCodeEditor,
    depth: number,
    selectionLines?: number[],
  ) => {
    const runId = ++foldingRun.current;
    const apply = async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (foldingRun.current !== runId) return;
      const foldAll = instance.getAction("editor.foldAll");
      if (!foldAll) return;
      await foldAll.run();
      if (foldingRun.current !== runId) return;
      if (depth === 0) {
        await instance.getAction("editor.unfoldAll")?.run();
      } else {
        await instance.getAction("editor.unfold")?.run({
          levels: depth,
          selectionLines:
            selectionLines && selectionLines.length > 0 ? selectionLines : [0],
        });
      }
    };
    void apply();
  };
  useEffect(
    () => () => {
      disposables.current.forEach((d) => d.dispose());
      selectionDisposable.current?.dispose();
      keyboardDisposable.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    const instance = editorRef.current;
    if (!instance || defaultExpandedDepth === undefined) return;
    applyDefaultFolding(instance, defaultExpandedDepth, defaultExpandedLines);
  }, [
    defaultExpandedDepth,
    defaultExpandedLines,
    readOnly ? value : undefined,
  ]);
  return (
    <Editor
      height={height}
      language={language}
      value={value}
      theme={theme === "dark" ? "vs-dark" : "light"}
      onChange={(v) => onChange?.(v || "")}
      onMount={(instance) => {
        editorRef.current = instance;
        if (defaultExpandedDepth !== undefined)
          applyDefaultFolding(
            instance,
            defaultExpandedDepth,
            defaultExpandedLines,
          );
        onReady?.(instance);
        selectionDisposable.current?.dispose();
        selectionDisposable.current = instance.onDidChangeCursorSelection(
          () => {
            const selection = instance.getSelection();
            const model = instance.getModel();
            selectionCallback.current?.(
              selection && model ? model.getValueInRange(selection) : "",
            );
          },
        );
        keyboardDisposable.current?.dispose();
        keyboardDisposable.current = readOnly
          ? undefined
          : instance.onKeyDown((event) => {
              if (
                queryKeyIntent(
                  event.browserEvent.key,
                  event.ctrlKey,
                  event.shiftKey,
                  event.metaKey,
                ) !== "unindent"
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              instance.trigger("keyboard", "editor.action.outdentLines", null);
            });
        if (!completionContext || readOnly) return;
        disposables.current.forEach((d) => d.dispose());
        disposables.current = [
          monaco.languages.registerCompletionItemProvider(language, {
            triggerCharacters: [".", "$", '"', "'"],
            provideCompletionItems(model, position) {
              if (model !== instance.getModel()) return { suggestions: [] };
              const word = model.getWordUntilPosition(position);
              const prefix = model.getValueInRange({
                startLineNumber: Math.max(1, position.lineNumber - 3),
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              });
              const collection = prefix.match(
                /getCollection\(\s*["']([^"']*)$/,
              );
              const startColumn = collection
                ? position.column - collection[1].length
                : word.startColumn -
                  (model.getLineContent(position.lineNumber)[
                    word.startColumn - 2
                  ] === "$"
                    ? 1
                    : 0);
              return {
                suggestions: mongoSuggestions(
                  prefix,
                  context.current || { fields: [], collections: [] },
                ).map((item) => ({
                  ...item,
                  kind:
                    item.detail === "Collection"
                      ? monaco.languages.CompletionItemKind.Module
                      : monaco.languages.CompletionItemKind.Field,
                  range: {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn,
                    endColumn: position.column,
                  },
                })),
              };
            },
          }),
        ];
      }}
      options={{
        readOnly,
        fontSize,
        fontFamily: editorFontFamily,
        lineHeight: editorLineHeight,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: tabWidth,
        insertSpaces: true,
        detectIndentation: false,
        folding: true,
        foldingStrategy: "indentation",
        showFoldingControls: "always",
        wordWrap: "on",
        padding: { top: editorPadding, bottom: editorPadding },
        renderLineHighlight: "none",
        fixedOverflowWidgets: true,
        contextmenu: true,
      }}
    />
  );
}

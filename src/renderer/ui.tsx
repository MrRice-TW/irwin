import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { settingsSchema, type Settings } from "../shared/contracts";

export type UiContextValue = Settings & {
  settings: Settings;
  t: (zh: string, en: string) => string;
};

const defaultSettings = settingsSchema.parse({});
export const UiContext = createContext<UiContextValue>({
  ...defaultSettings,
  settings: defaultSettings,
  t: (zh: string, _en: string) => zh,
});
export const useUi = () => useContext(UiContext);
export function Modal({
  title,
  children,
  footer,
  close,
  wide = false,
  resizable = false,
  documentViewer = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  close(): void;
  wide?: boolean;
  resizable?: boolean;
  documentViewer?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useUi();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""} ${resizable ? "resizable" : ""} ${documentViewer ? "document-viewer" : ""} ${maximized ? "maximized" : ""} ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <div className="modal-head-actions">
          {resizable && (
            <button
              className="icon"
              onClick={() => setMaximized((old) => !old)}
              aria-label={
                maximized
                  ? t("還原視窗", "Restore window")
                  : t("放大視窗", "Maximize window")
              }
              title={
                maximized
                  ? t("還原視窗", "Restore window")
                  : t("放大視窗", "Maximize window")
              }
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <button
            className="icon"
            onClick={close}
            aria-label={t("關閉", "Close")}
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
export function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export const api = window.workbench;
export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

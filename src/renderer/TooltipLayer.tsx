import { createPortal } from "react-dom";
import { useEffect, useId, useState } from "react";

type TooltipTarget = HTMLElement;
type TooltipState = {
  target: TooltipTarget;
  text: string;
  left: number;
  top: number;
  placement: "above" | "below";
  host: HTMLElement;
};

const targetSelector =
  'button[title], button[data-irwin-tooltip], [role="button"][title], [role="button"][data-irwin-tooltip]';

function tooltipText(target: TooltipTarget, savedTitles: WeakMap<TooltipTarget, string>) {
  return target.getAttribute("title") ?? savedTitles.get(target) ?? "";
}

function tooltipPosition(target: TooltipTarget) {
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const halfWidth = Math.min(160, Math.max(0, (viewportWidth - 24) / 2));
  const center = rect.left + rect.width / 2;
  const left = Math.min(
    Math.max(center, 12 + halfWidth),
    viewportWidth - 12 - halfWidth,
  );
  const placement = rect.top >= 48 ? "above" : "below";
  return {
    left,
    top: placement === "above" ? rect.top - 7 : rect.bottom + 7,
    placement,
  } as const;
}

export function TooltipLayer() {
  const tooltipId = `irwin-tooltip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const savedTitles = new WeakMap<TooltipTarget, string>();
    let pointerTarget: TooltipTarget | null = null;
    let focusTarget: TooltipTarget | null = null;
    let describedTarget: TooltipTarget | null = null;
    let showTimer: ReturnType<typeof setTimeout> | undefined;

    const activeTarget = () => pointerTarget ?? focusTarget;
    const findTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      return target.closest<TooltipTarget>(targetSelector);
    };
    const saveAndSuppressNativeTitle = (target: TooltipTarget) => {
      const title = tooltipText(target, savedTitles).trim();
      if (!title) return "";
      savedTitles.set(target, title);
      target.setAttribute("data-irwin-tooltip", title);
      target.removeAttribute("title");
      return title;
    };
    const detachDescription = () => {
      if (!describedTarget) return;
      const remaining = (describedTarget.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((id) => id && id !== tooltipId);
      if (remaining.length)
        describedTarget.setAttribute("aria-describedby", remaining.join(" "));
      else describedTarget.removeAttribute("aria-describedby");
      describedTarget = null;
    };
    const releaseIfInactive = (target: TooltipTarget | null) => {
      if (!target || target === pointerTarget || target === focusTarget) return;
      const title = savedTitles.get(target);
      target.removeAttribute("data-irwin-tooltip");
      if (title && !target.hasAttribute("title"))
        target.setAttribute("title", title);
      savedTitles.delete(target);
    };
    const hide = () => {
      if (showTimer) clearTimeout(showTimer);
      showTimer = undefined;
      detachDescription();
      setTooltip(null);
    };
    const schedule = () => {
      if (showTimer) clearTimeout(showTimer);
      showTimer = undefined;
      detachDescription();
      setTooltip(null);
      const target = activeTarget();
      if (!target) return;
      const text = saveAndSuppressNativeTitle(target);
      if (!text) return;

      showTimer = setTimeout(() => {
        showTimer = undefined;
        if (activeTarget() !== target) return;
        const existing = target.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
        if (!existing.includes(tooltipId)) existing.push(tooltipId);
        target.setAttribute("aria-describedby", existing.filter(Boolean).join(" "));
        describedTarget = target;
        const dialog = target.closest<HTMLElement>("dialog[open]");
        setTooltip({
          target,
          text: tooltipText(target, savedTitles).trim() || text,
          ...tooltipPosition(target),
          host: dialog ?? document.body,
        });
      }, 450);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen")
        return;
      const target = findTarget(event.target);
      if (!target || target === pointerTarget) return;
      const previous = pointerTarget;
      pointerTarget = target;
      releaseIfInactive(previous);
      schedule();
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = pointerTarget;
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
        return;
      pointerTarget = null;
      releaseIfInactive(target);
      if (activeTarget()) schedule();
      else hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = findTarget(event.target);
      if (!target || target === focusTarget) return;
      const previous = focusTarget;
      focusTarget = target;
      releaseIfInactive(previous);
      schedule();
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = focusTarget;
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
        return;
      focusTarget = null;
      releaseIfInactive(target);
      if (activeTarget()) schedule();
      else hide();
    };
    const reposition = () => {
      setTooltip((current) =>
        current
          ? { ...current, ...tooltipPosition(current.target) }
          : current,
      );
    };

    // React can update a tooltip label while its control remains hovered. Keep
    // the native popup suppressed and refresh the visible copy in that case.
    const titleObserver = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as TooltipTarget;
        if (target !== pointerTarget && target !== focusTarget) continue;
        const updatedTitle = target.getAttribute("title");
        if (!updatedTitle) continue;
        savedTitles.set(target, updatedTitle.trim());
        target.setAttribute("data-irwin-tooltip", updatedTitle.trim());
        target.removeAttribute("title");
        setTooltip((current) =>
          current?.target === target
            ? { ...current, text: updatedTitle.trim() }
            : current,
        );
      }
    });
    titleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["title"],
      subtree: true,
    });

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      if (showTimer) clearTimeout(showTimer);
      titleObserver.disconnect();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      detachDescription();
      const oldPointerTarget = pointerTarget;
      const oldFocusTarget = focusTarget;
      pointerTarget = null;
      focusTarget = null;
      releaseIfInactive(oldPointerTarget);
      releaseIfInactive(oldFocusTarget);
    };
  }, [tooltipId]);

  if (!tooltip) return null;
  return createPortal(
    <div
      id={tooltipId}
      className="app-tooltip"
      role="tooltip"
      data-placement={tooltip.placement}
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>,
    tooltip.host,
  );
}

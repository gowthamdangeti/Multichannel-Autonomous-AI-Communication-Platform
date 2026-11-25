import * as React from "react"
import { useCallback, useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
  minRows?: number;
  maxRows?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      autoResize,
      minRows,
      maxRows,
      value,
      onChange,
      rows,
      style,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);

    const handleRef = (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    };

    const isAutoResize = autoResize || minRows !== undefined || maxRows !== undefined;
    const effectiveMinRows = minRows ?? rows ?? 3;
    const effectiveMaxRows = maxRows ?? 6;

    const adjustHeight = useCallback(() => {
      const el = internalRef.current;
      if (!el || !isAutoResize) return;
      const prevScrollTop = el.scrollTop;
      el.style.height = "auto";
      const computed = window.getComputedStyle(el);
      const lineHeight = parseFloat(computed.lineHeight) || 20;
      const paddingTop = parseFloat(computed.paddingTop) || 8;
      const paddingBottom = parseFloat(computed.paddingBottom) || 8;

      const minHeight = lineHeight * effectiveMinRows + paddingTop + paddingBottom;
      const maxHeight = lineHeight * effectiveMaxRows + paddingTop + paddingBottom;

      const targetHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
      el.style.height = `${targetHeight}px`;
      el.scrollTop = prevScrollTop;
    }, [isAutoResize, effectiveMinRows, effectiveMaxRows]);

    useEffect(() => {
      if (isAutoResize) {
        adjustHeight();
      }
    }, [value, adjustHeight, isAutoResize]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (isAutoResize) {
        adjustHeight();
      }
      if (onChange) onChange(e);
    };

    return (
      <textarea
        ref={handleRef}
        data-slot="textarea"
        value={value}
        onChange={handleChange}
        rows={isAutoResize ? effectiveMinRows : rows}
        className={cn(
          "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-md border-[length:var(--surface-border-width)] bg-card px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm break-words [overflow-wrap:anywhere]",
          isAutoResize && "resize-none overflow-y-auto whitespace-pre-wrap transition-[height] duration-100 ease-out",
          className
        )}
        style={style}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";

export { Textarea };

"use client";

import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Embedded code snippet display with VS Code-style syntax highlighting
 * and line numbers matching the design in the Embed modal.
 *
 * Uses semantic CSS variables from globals.css for full design token compliance.
 */

// One pass over each line of code; each alternative is a token kind in priority order.
const LINE_TOKEN = new RegExp(
  [
    String.raw`(<!--[\s\S]*?-->)`, // 1 HTML comment
    String.raw`(<\/?)(\w+)(>)`, // 2 tag open bracket, 3 tag name, 4 tag close bracket (e.g. <script> or </script>)
    String.raw`(<\/?)([A-Za-z][\w-]*)`, // 5 tag open bracket, 6 tag name
    String.raw`(>)`, // 7 standalone tag close bracket
    String.raw`('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`, // 8 string literal
    String.raw`\b(function|var|let|const|new|typeof|instanceof)\b`, // 9 declaration keyword
    String.raw`\b(if|else|return|for|while|do|switch|case|break|continue)\b`, // 10 control flow keyword
    String.raw`\b(true|false|null|undefined|NaN)\b`, // 11 literal / boolean
    String.raw`\b(document|window|console)\b`, // 12 built-in object
    String.raw`\b(\d+(?:\.\d+)?)\b`, // 13 number
    String.raw`([A-Za-z_$][\w$]*)(?=\s*\()`, // 14 function call
    String.raw`(\.)([A-Za-z_$][\w$]*)`, // 15 dot, 16 property access
    String.raw`([A-Za-z_$][\w$]*)`, // 17 variable / identifier
    String.raw`([=+\-*/%&|^!~?:;,])`, // 18 operators / punctuation
    String.raw`([(){}\[\]])`, // 19 brackets / parentheses
  ].join("|"),
  "g",
);

function highlightLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  const span = (cls: string, text: string) => (
    <span key={key++} className={cls}>
      {text}
    </span>
  );

  for (const m of line.matchAll(LINE_TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) {
      out.push(<Fragment key={key++}>{line.slice(last, start)}</Fragment>);
    }

    if (m[1]) {
      // 1 HTML comment
      out.push(span("text-code-token-comment italic", m[1]));
    } else if (m[2] && m[3] && m[4]) {
      // 2-4 Complete HTML tag e.g. <script> or </script>
      out.push(
        span("text-code-token-tag-bracket", m[2]),
        span("text-code-token-tag-name font-medium", m[3]),
        span("text-code-token-tag-bracket", m[4]),
      );
    } else if (m[5] && m[6]) {
      // 5-6 Opening tag bracket + tag name
      out.push(
        span("text-code-token-tag-bracket", m[5]),
        span("text-code-token-tag-name font-medium", m[6]),
      );
    } else if (m[7]) {
      // 7 Standalone closing tag bracket
      out.push(span("text-code-token-tag-bracket", m[7]));
    } else if (m[8]) {
      // 8 String literal
      out.push(span("text-code-token-string font-medium", m[8]));
    } else if (m[9]) {
      // 9 Declaration keyword: function, var, let, const
      out.push(span("text-code-token-keyword font-semibold", m[9]));
    } else if (m[10]) {
      // 10 Control keyword: if, return, else
      out.push(span("text-code-token-control font-semibold", m[10]));
    } else if (m[11]) {
      // 11 Literal / boolean: true, false, null
      out.push(span("text-code-token-literal font-semibold", m[11]));
    } else if (m[12]) {
      // 12 Built-in: document, window
      out.push(span("text-code-token-variable font-semibold", m[12]));
    } else if (m[13]) {
      // 13 Number: 0, 1...
      out.push(span("text-code-token-number font-mono", m[13]));
    } else if (m[14]) {
      // 14 Function call: getElementsByTagName, createElement...
      out.push(span("text-code-token-call font-medium", m[14]));
    } else if (m[15] && m[16]) {
      // 15-16 Property access: .src, .id, .async, .parentNode
      out.push(
        span("text-code-token-punctuation", m[15]),
        span("text-code-token-property font-medium", m[16]),
      );
    } else if (m[17]) {
      // 17 Variable / identifier: js, fjs, d, s, id
      out.push(span("text-code-token-variable", m[17]));
    } else if (m[18]) {
      // 18 Operator / punctuation: =, ;, ,, +, -
      out.push(span("text-code-token-punctuation", m[18]));
    } else if (m[19]) {
      // 19 Parentheses & brackets: (, ), {, }, [, ]
      out.push(span("text-code-token-paren", m[19]));
    }

    last = start + m[0].length;
  }

  if (last < line.length) {
    out.push(<Fragment key={key++}>{line.slice(last)}</Fragment>);
  }

  return out;
}

export function EmbedCodeBlock({ code, className }: { code: string; className?: string }) {
  const lines = code.trim().split("\n");

  return (
    <div
      className={cn(
        "relative rounded-lg border border-code-editor-border bg-code-editor-bg overflow-hidden shadow-sm",
        className,
      )}
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-code-editor-border/60 bg-code-editor-bg select-none">
        <span className="text-xs font-mono font-medium text-code-token-gutter tracking-wide">
          HTML • JavaScript
        </span>
        <span className="text-xs font-mono text-code-token-gutter/80">
          Read-only snippet
        </span>
      </div>

      {/* Code Editor Body with Line Numbers */}
      <div className="p-3.5 overflow-x-auto">
        <div className="font-mono text-xs leading-relaxed">
          {lines.map((line, idx) => (
            <div key={idx} className="flex items-start min-w-0">
              <span className="w-6 sm:w-7 shrink-0 text-right pr-3 sm:pr-4 select-none text-code-token-gutter font-mono text-xs leading-relaxed">
                {idx + 1}
              </span>
              <span className="flex-1 whitespace-pre-wrap break-all select-all font-mono text-xs leading-relaxed text-zinc-200">
                {highlightLine(line)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

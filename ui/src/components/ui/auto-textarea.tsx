import * as React from "react";

import { Textarea, type TextareaProps } from "@/components/ui/textarea";

export type AutoTextareaProps = TextareaProps;

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  (props, ref) => {
    return <Textarea ref={ref} autoResize={true} {...props} />;
  }
);

AutoTextarea.displayName = "AutoTextarea";

export { AutoTextarea };

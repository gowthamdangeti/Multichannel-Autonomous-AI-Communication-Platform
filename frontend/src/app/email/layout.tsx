import { ReactNode } from "react";

export default function EmailLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <main className="flex-1 flex flex-col min-h-0 px-4 pb-4 pt-1 overflow-hidden">{children}</main>
    </div>
  );
}

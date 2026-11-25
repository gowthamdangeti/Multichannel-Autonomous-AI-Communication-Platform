import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

interface PageSearchInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function PageSearchInput({ placeholder, value, onChange }: PageSearchInputProps) {
  return (
    <div className="relative min-w-56 flex-1">
      <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full pl-10"
      />
    </div>
  );
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_FILTER, type FilterOption } from "@/lib/searchFilter";

interface PageFilterSelectProps {
  allLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

export function PageFilterSelect({ allLabel, value, options, onChange }: PageFilterSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={allLabel} className="h-9 w-44">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        <SelectItem value={ALL_FILTER}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

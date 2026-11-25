import { AlertCircle, ArrowLeft, Calendar, CheckSquare, Filter, Hash, Radio, RefreshCw, Tag, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { FilterTemplatesMenu } from "@/components/filters/FilterTemplatesMenu";
import { MultiSelectFilter } from "@/components/filters/MultiSelectFilter";
import { NumberFilter } from "@/components/filters/NumberFilter";
import { NumberRangeFilter } from "@/components/filters/NumberRangeFilter";
import { RadioFilter } from "@/components/filters/RadioFilter";
import { TagInputFilter } from "@/components/filters/TagInputFilter";
import { TextFilter } from "@/components/filters/TextFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDateRange, formatNumberRange, getDefaultValue, validateFilter } from "@/lib/filters";
import { ActiveFilter, DateRangeValue, FilterAttribute, FilterTemplate, FilterValue, MultiSelectValue, NumberRangeValue, NumberValue, RadioValue, TextValue } from "@/types/filters";

interface FilterBuilderProps {
  availableAttributes: FilterAttribute[];
  activeFilters: ActiveFilter[];
  onFiltersChange: (filters: ActiveFilter[]) => void;
  /** Apply filters; `filters` is passed when applying a list that is not in state yet. */
  onApplyFilters: (filters?: ActiveFilter[]) => void;
  onClearFilters?: () => void;
  isExecuting?: boolean;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  hasAppliedFilters?: boolean;
  /** "card" (default): a full card. "toolbar": Templates + Filter buttons for a list header. */
  variant?: "card" | "toolbar";
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({
  availableAttributes,
  activeFilters,
  onFiltersChange,
  onApplyFilters,
  onClearFilters,
  isExecuting = false,
  autoRefresh = false,
  onAutoRefreshChange,
  variant = "card",
  hasAppliedFilters = false,
}) => {
  const [selectedAttribute, setSelectedAttribute] = useState<string>("");
  // Toolbar mode (Voice conversations layout): popover stage and the picked template.
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editingAttributeId, setEditingAttributeId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [expandedFilters, setExpandedFilters] = useState<Set<number>>(new Set());

  // Auto-expand new filters
  useEffect(() => {
    if (activeFilters.length > 0) {
      setExpandedFilters(new Set([activeFilters.length - 1]));
    }
  }, [activeFilters.length]);

  // Handle Command+Enter (Mac) or Ctrl+Enter (Windows/Linux) to apply filters
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
      const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;

      if (isModifierPressed && event.key === 'Enter') {
        event.preventDefault();
        const allFiltersValid = activeFilters.every(f => f.isValid);
        const canApply = (activeFilters.length > 0 && allFiltersValid) || (activeFilters.length === 0 && hasAppliedFilters);
        if (canApply && !isExecuting) {
          onApplyFilters();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeFilters, isExecuting, onApplyFilters, hasAppliedFilters]);

  const addFilter = useCallback((attributeId: string) => {
    const attribute = availableAttributes.find(attr => attr.id === attributeId);
    if (!attribute) return;

    const defaultValue = getDefaultValue(attribute.type);
    const newFilter: ActiveFilter = {
      attribute,
      value: defaultValue,
      isValid: false,
    };

    onFiltersChange([...activeFilters, newFilter]);
    setSelectedAttribute("");
  }, [availableAttributes, activeFilters, onFiltersChange]);

  const updateFilter = useCallback((index: number, value: FilterValue) => {
    const newFilters = [...activeFilters];
    newFilters[index].value = value;
    newFilters[index].isValid = validateFilter(newFilters[index]) === null;
    onFiltersChange(newFilters);
  }, [activeFilters, onFiltersChange]);

  const removeFilter = useCallback((index: number) => {
    onFiltersChange(activeFilters.filter((_, i) => i !== index));
    setExpandedFilters(prev => {
      const newSet = new Set(prev);
      newSet.delete(index);
      return newSet;
    });
  }, [activeFilters, onFiltersChange]);

  const clearAllFilters = useCallback(() => {
    onFiltersChange([]);
    setExpandedFilters(new Set());
    if (onClearFilters) {
      onClearFilters();
    }
  }, [onFiltersChange, onClearFilters]);

  const applyTemplate = useCallback((template: FilterTemplate) => {
    const newFilters: ActiveFilter[] = template.filters.map(filterConfig => {
      const attribute = availableAttributes.find(attr => attr.id === filterConfig.attributeId);
      if (!attribute) {
        console.warn(`Attribute ${filterConfig.attributeId} not found`);
        return null;
      }

      const filter: ActiveFilter = {
        attribute,
        value: filterConfig.value,
        isValid: false,
      };
      filter.isValid = validateFilter(filter) === null;
      return filter;
    }).filter((f): f is ActiveFilter => f !== null);

    onFiltersChange(newFilters);
    setExpandedFilters(new Set());
  }, [availableAttributes, onFiltersChange]);

  const toggleFilterExpanded = (index: number) => {
    setExpandedFilters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const getFilterIcon = (type: FilterAttribute["type"]) => {
    switch (type) {
      case "dateRange":
        return <Calendar className="h-4 w-4" />;
      case "multiSelect":
        return <CheckSquare className="h-4 w-4" />;
      case "number":
      case "numberRange":
        return <Hash className="h-4 w-4" />;
      case "radio":
        return <Radio className="h-4 w-4" />;
      case "tags":
        return <Tag className="h-4 w-4" />;
      case "text":
        return <Hash className="h-4 w-4" />;
    }
  };

  const getFilterSummary = (filter: ActiveFilter): string => {
    switch (filter.attribute.type) {
      case "dateRange":
        return formatDateRange(filter.value as DateRangeValue);
      case "multiSelect": {
        const value = filter.value as MultiSelectValue;
        if (value.codes.length === 0) return "No options selected";
        if (value.codes.length <= 3) return value.codes.join(", ");
        return `${value.codes.slice(0, 3).join(", ")} +${value.codes.length - 3} more`;
      }
      case "number": {
        const value = filter.value as NumberValue;
        return value.value !== null ? value.value.toString() : "No value";
      }
      case "numberRange":
        return formatNumberRange(filter.value as NumberRangeValue, filter.attribute.config.unit);
      case "radio": {
        const value = filter.value as RadioValue;
        const option = filter.attribute.config.radioOptions?.find(opt => opt.value === value.status);
        return option?.label || value.status;
      }
      case "tags": {
        const value = filter.value as MultiSelectValue;
        if (value.codes.length === 0) return "No tags";
        if (value.codes.length <= 3) return value.codes.join(", ");
        return `${value.codes.slice(0, 3).join(", ")} +${value.codes.length - 3} more`;
      }
      case "text": {
        const value = filter.value as TextValue;
        return value.value || "No value";
      }
    }
  };

  const renderFilterInput = (filter: ActiveFilter, index: number) => {
    const error = filter.isValid ? undefined : validateFilter(filter) || undefined;

    switch (filter.attribute.type) {
      case "dateRange":
        return (
          <DateRangeFilter
            value={filter.value as DateRangeValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
            presets={filter.attribute.config.datePresets}
          />
        );
      case "multiSelect":
        return (
          <MultiSelectFilter
            options={filter.attribute.config.options || []}
            value={filter.value as MultiSelectValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
            showSelectAll={filter.attribute.config.showSelectAll}
            searchable={filter.attribute.config.searchable}
          />
        );
      case "number":
        return (
          <NumberFilter
            value={filter.value as NumberValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
            placeholder={filter.attribute.config.placeholder}
            min={filter.attribute.config.min}
            max={filter.attribute.config.max}
            step={filter.attribute.config.step}
          />
        );
      case "numberRange":
        return (
          <NumberRangeFilter
            value={filter.value as NumberRangeValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
            unit={filter.attribute.config.unit}
            min={filter.attribute.config.min}
            max={filter.attribute.config.max}
            step={filter.attribute.config.step}
            presets={filter.attribute.config.numberPresets}
          />
        );
      case "radio":
        return (
          <RadioFilter
            value={filter.value as RadioValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
            options={filter.attribute.config.radioOptions || []}
          />
        );
      case "tags":
        return (
          <TagInputFilter
            value={filter.value as MultiSelectValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
          />
        );
      case "text":
        return (
          <TextFilter
            value={filter.value as TextValue}
            onChange={(value) => updateFilter(index, value)}
            error={error}
            placeholder={filter.attribute.config.placeholder}
            maxLength={filter.attribute.config.maxLength}
          />
        );
    }
  };

  const allFiltersValid = activeFilters.every(f => f.isValid);
  const availableAttributesForAdding = availableAttributes.filter(
    attr => !activeFilters.some(f => f.attribute.id === attr.id)
  );

  // Shared by both layouts: the templates menu and the filter editor.
  const templatesMenu = (
    <FilterTemplatesMenu
      selectedTemplateId={selectedTemplateId}
      onSelect={(template) => {
        setSelectedTemplateId(template.id);
        applyTemplate(template);
      }}
    />
  );

  const filtersBody = (
        <div className="space-y-4">
          {/* Add Filter Row */}
          <div className="flex gap-2">
            <Select value={selectedAttribute} onValueChange={(value) => {
              addFilter(value);
            }}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select attribute to filter by" />
              </SelectTrigger>
              <SelectContent>
                {availableAttributesForAdding.map((attr) => (
                  <SelectItem key={attr.id} value={attr.id}>
                    <div className="flex items-center gap-2">
                      {getFilterIcon(attr.type)}
                      <span>{attr.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeFilters.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
              >
                Clear All
              </Button>
            )}
          </div>

          {/* Active Filters */}
          {activeFilters.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Active Filters</h4>
              </div>

              {activeFilters.map((filter, index) => (
                <Card key={index} className={filter.isValid ? "" : "border-red-200"}>
                  <CardHeader className="pb-3">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => toggleFilterExpanded(index)}
                    >
                      <div className="flex items-center gap-2">
                        {getFilterIcon(filter.attribute.type)}
                        <span className="font-medium">{filter.attribute.label}</span>
                        {!filter.isValid && (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!expandedFilters.has(index) && (
                          <span className="text-sm text-muted-foreground">
                            {getFilterSummary(filter)}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFilter(index);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {expandedFilters.has(index) && (
                    <CardContent>
                      {renderFilterInput(filter, index)}
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Apply Filters Button */}
          {(activeFilters.length > 0 || hasAppliedFilters) && (
            <div className="flex justify-between items-center gap-2 pt-2">
              {/* Auto-refresh toggle on the left */}
              {onAutoRefreshChange && (
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={autoRefresh}
                    onCheckedChange={onAutoRefreshChange}
                    id="auto-refresh"
                  />
                  <label htmlFor="auto-refresh" className="text-sm font-medium cursor-pointer">
                    Auto-refresh every 5s
                  </label>
                  {autoRefresh && (
                    <RefreshCw className="h-4 w-4 text-gray-500 animate-spin" />
                  )}
                </div>
              )}

              {/* Buttons on the right */}
              <div className="flex gap-2 ml-auto">
                <Button
                  onClick={() => onApplyFilters()}
                  disabled={(activeFilters.length > 0 && !allFiltersValid) || isExecuting}
                  title={"Apply filters"}
                >
                  {isExecuting ? "Applying..." : `Apply (${navigator.userAgent.toUpperCase().indexOf('MAC') >= 0 ? '⌘' : 'Ctrl'}+Enter)`}
                </Button>
              </div>
            </div>
          )}
        </div>
  );

  // Toolbar: the exact Voice conversations filter — Templates menu + two-stage attribute popover.
  if (variant === "toolbar") {
    const templateFilters = (template: FilterTemplate): ActiveFilter[] =>
      template.filters
        .map((config) => {
          const attribute = availableAttributes.find((attr) => attr.id === config.attributeId);
          if (!attribute) return null;
          const filter: ActiveFilter = { attribute, value: config.value, isValid: false };
          filter.isValid = validateFilter(filter) === null;
          return filter;
        })
        .filter((f): f is ActiveFilter => f !== null);

    const applyTemplateNow = (template: FilterTemplate) => {
      const next = templateFilters(template);
      setSelectedTemplateId(template.id);
      onFiltersChange(next);
      onApplyFilters(next);
    };
    const applyNow = () => {
      setSelectedTemplateId(null); // manual edit → no longer a template
      setPopoverOpen(false);
      onApplyFilters();
    };
    const removeAndApply = (attributeId: string) => {
      const next = activeFilters.filter((f) => f.attribute.id !== attributeId);
      setSelectedTemplateId(null);
      onFiltersChange(next);
      onApplyFilters(next);
    };
    const clearAll = () => {
      setSelectedTemplateId(null);
      setPopoverOpen(false);
      setEditingAttributeId(null);
      onFiltersChange([]);
      onClearFilters?.();
    };

    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Templates — shared menu with icons */}
        <FilterTemplatesMenu selectedTemplateId={selectedTemplateId} onSelect={applyTemplateNow} />

        {/* Single Multi-Stage Popover Filter */}
        <Popover
          open={popoverOpen}
          onOpenChange={(open) => {
            setPopoverOpen(open);
            setEditingAttributeId(null);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 text-xs flex items-center gap-1.5">
              <Filter className="h-4 w-4" />
              <span>Select attribute to filter by</span>
              {hasAppliedFilters && activeFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px] font-semibold bg-primary/10 text-primary border-none">
                  {activeFilters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4" align="end">
            {editingAttributeId === null ? (
              /* Main View: List of available attributes */
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b pb-2 mb-1">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Filter className="h-3.5 w-3.5" />
                    Filter Attributes
                  </span>
                </div>
                <div className="space-y-1">
                  {availableAttributes.map((attr) => {
                    const activeFilter = activeFilters.find((f) => f.attribute.id === attr.id);
                    return (
                      <div key={attr.id} className="flex items-center justify-between group hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors">
                        <button
                          type="button"
                          onClick={() => {
                            if (!activeFilter) addFilter(attr.id);
                            setEditingAttributeId(attr.id);
                          }}
                          className="flex items-center justify-between flex-1 text-left text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground group-hover:text-foreground">{getFilterIcon(attr.type)}</span>
                            <span className="font-medium text-foreground">{attr.label}</span>
                          </div>
                          {activeFilter && (
                            <span className="text-[11px] text-muted-foreground max-w-[120px] truncate mr-2 font-semibold">
                              {getFilterSummary(activeFilter)}
                            </span>
                          )}
                        </button>
                        {activeFilter && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-red-500"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAndApply(attr.id);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {activeFilters.length > 0 && (
                  <div className="border-t pt-2 mt-2 flex justify-between gap-2">
                    <Button variant="ghost" size="sm" className="h-8 text-xs flex-1 text-muted-foreground hover:text-foreground" onClick={clearAll}>
                      Clear All
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* Edit View: Filter input rendering */
              (() => {
                const attr = availableAttributes.find((a) => a.id === editingAttributeId);
                const filterIndex = activeFilters.findIndex((f) => f.attribute.id === editingAttributeId);
                if (!attr || filterIndex === -1) return null;
                const filter = activeFilters[filterIndex];
                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b pb-2 mb-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingAttributeId(null)}>
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        {getFilterIcon(attr.type)}
                        {attr.label}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-red-500"
                        onClick={() => {
                          removeAndApply(attr.id);
                          setEditingAttributeId(null);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-3">{renderFilterInput(filter, filterIndex)}</div>
                    <div className="flex justify-between gap-2 pt-2 border-t mt-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs flex-1" onClick={() => setEditingAttributeId(null)}>
                        Back
                      </Button>
                      <Button size="sm" className="h-8 text-xs flex-1" onClick={applyNow} disabled={!filter.isValid || isExecuting}>
                        Apply
                      </Button>
                    </div>
                  </div>
                );
              })()
            )}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Filter runs</CardTitle>
            <CardDescription>
              Add filters to narrow the list
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {templatesMenu}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtersBody}
      </CardContent>
    </Card>
  );
};

"use client";

import { Check, Sparkles } from "lucide-react";

export interface PlanItem {
  id: number | string;
  name: string;
  price_per_month: number;
  currency: "INR" | "USD" | string;
  included_credits?: number;
  included_minutes?: number;
  included_messages?: number;
  concurrency_limit?: number;
  description?: string;
  is_popular?: boolean;
}


interface SignupPlanCardProps {
  plan: PlanItem;
  isSelected: boolean;
  onSelect: () => void;
}

export function SignupPlanCard({ plan, isSelected, onSelect }: SignupPlanCardProps) {
  const isINR = plan.currency.toUpperCase() === "INR";
  const symbol = isINR ? "₹" : "$";
  const formattedPrice = Number(plan.price_per_month).toLocaleString();

  return (
    <div
      onClick={onSelect}
      className={`relative cursor-pointer rounded-xl border p-5 transition-all duration-200 flex flex-col justify-between ${
        isSelected
          ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/30"
          : "border-border bg-card/60 hover:border-muted-foreground/30 hover:bg-card/90"
      }`}
    >
      {plan.is_popular && (
        <div className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm">
          <Sparkles className="size-3" />
          <span>Most Popular</span>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-tight text-foreground">{plan.name}</h3>
          <div
            className={`size-5 rounded-full border flex items-center justify-center transition-colors ${
              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
            }`}
          >
            {isSelected && <Check className="size-3.5 stroke-[3]" />}
          </div>
        </div>

        {plan.description && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{plan.description}</p>
        )}

        <div className="mt-4 flex items-baseline gap-1">
          <span className="text-3xl font-extrabold tracking-tight text-foreground">
            {symbol}{formattedPrice}
          </span>
          <span className="text-xs text-muted-foreground font-medium">/month</span>
        </div>

        <div className="mt-5 space-y-2 text-xs text-muted-foreground border-t pt-4 border-border/60">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-primary shrink-0" />
            <span>
              <strong className="text-foreground font-medium">
                {(plan.included_credits ?? plan.included_minutes ?? 1000).toLocaleString()}
              </strong>{" "}
              Monthly Voice Minutes
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Check className="size-4 text-primary shrink-0" />
            <span>
              <strong className="text-foreground font-medium">
                {(plan.included_messages ?? 1000).toLocaleString()}
              </strong>{" "}
              Monthly Messages
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Check className="size-4 text-primary shrink-0" />
            <span>Telephony & WebRTC Agents</span>
          </div>

          <div className="flex items-center gap-2">
            <Check className="size-4 text-primary shrink-0" />
            <span>24/7 Dedicated Support</span>
          </div>
        </div>

      </div>

      <button
        type="button"
        className={`mt-6 w-full rounded-lg py-2 px-3 text-xs font-semibold transition-all ${
          isSelected
            ? "bg-primary text-primary-foreground shadow"
            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
        }`}
      >
        {isSelected ? "Selected" : "Select Plan"}
      </button>
    </div>
  );
}

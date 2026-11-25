import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function OverviewErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}

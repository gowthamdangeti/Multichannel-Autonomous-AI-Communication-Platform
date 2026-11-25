import { Suspense } from "react";

import { OverviewView } from "@/components/overview/OverviewView";

export default function OverviewPage() {
  // OverviewView reads ?channel=, which needs a Suspense boundary in the app router.
  return (
    <Suspense>
      <OverviewView />
    </Suspense>
  );
}

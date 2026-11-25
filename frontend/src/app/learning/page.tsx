"use client";

import { BookOpen, GraduationCap, Sparkles,Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LearningPage() {
  return (
    <div className="space-y-6 px-1 pr-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
            Coming Soon
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Learning, reimagined for interview prep
        </p>
      </div>

      {/* Coming Soon Hero */}
      <Card className="border-border/50 bg-gradient-to-br from-cta/5 via-background to-background">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cta/10">
            <GraduationCap className="h-8 w-8 text-cta" />
          </div>
          <CardTitle className="text-2xl">Learning, reimagined for interview prep.</CardTitle>
          <CardDescription className="text-base mt-2">
            Bite-sized lessons, hand-picked resources, and adaptive paths
            <br />
            that meet you where you are. We&apos;re polishing the experience now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mx-auto max-w-md">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="you@company.com"
                className="flex-1"
              />
              <Button className="bg-cta hover:bg-cta/90 shrink-0">
                Notify me
              </Button>
            </div>
          </div>

          {/* Feature Preview */}
          <div className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card p-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cta/10">
                <BookOpen className="h-5 w-5 text-cta" />
              </div>
              <p className="text-sm font-medium">Curated tracks</p>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card p-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cta/10">
                <Target className="h-5 w-5 text-cta" />
              </div>
              <p className="text-sm font-medium">Daily insights</p>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card p-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cta/10">
                <Sparkles className="h-5 w-5 text-cta" />
              </div>
              <p className="text-sm font-medium">AI personalized</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Additional Info */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <h3 className="font-medium">What to expect</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />
            <span>Structured learning paths for technical interviews</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />
            <span>Interactive coding challenges with AI feedback</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />
            <span>Progress tracking and skill assessments</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />
            <span>Company-specific preparation materials</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

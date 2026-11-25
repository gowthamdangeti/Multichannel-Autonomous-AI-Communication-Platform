"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    LabelList,
    Line,
    Pie,
    PieChart,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    RadialBar,
    RadialBarChart,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function fmtDate(dateStr: string) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en", {
        month: "short",
        day: "numeric",
    });
}

export function fmtDuration(seconds: number) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function fmtDelta(current: number, prev: number) {
    if (prev === 0) return null;
    const pct = Math.round(((current - prev) / prev) * 100);
    return pct;
}

function ChartHeading({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <CardHeader className="space-y-1 px-5 pt-5 pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
            {subtitle && <CardDescription className="text-xs">{subtitle}</CardDescription>}
        </CardHeader>
    );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

interface StatCardProps {
    label: string;
    value: string | number;
    delta?: number | null;
    sub?: string;
    loading?: boolean;
    icon?: ReactNode;
}

export function StatCard({ label, value, delta, sub, loading, icon }: StatCardProps) {
    return (
        <Card className="h-full transition-transform duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            <CardContent className="flex h-full flex-col px-5 pt-4 pb-4">
                {loading ? (
                    <div className="flex h-full flex-col">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="mt-2 h-8 w-16" />
                        <Skeleton className="mt-auto h-3 w-20" />
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                                {label}
                            </p>
                            {icon && (
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    {icon}
                                </span>
                            )}
                        </div>
                        <p className="mt-1.5 text-3xl font-semibold leading-none tracking-tight">
                            {value}
                        </p>
                        <div className="mt-auto flex min-h-4 items-center gap-1.5 pt-2 text-xs text-muted-foreground">
                            {delta !== null && delta !== undefined && (
                                <span
                                    className={cn(
                                        "inline-flex items-center gap-0.5 font-medium",
                                        delta >= 0 ? "text-emerald-500" : "text-rose-500"
                                    )}
                                >
                                    {delta >= 0 ? (
                                        <TrendingUp className="h-3 w-3" />
                                    ) : (
                                        <TrendingDown className="h-3 w-3" />
                                    )}
                                    {delta >= 0 ? "+" : ""}
                                    {delta}%
                                </span>
                            )}
                            {sub && <span>{sub}</span>}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Area Chart (call volume trend) ─────────────────────────────────────────

interface DailyPoint {
    date: string;
    calls: number;
}

interface CallVolumeChartProps {
    data: DailyPoint[];
    loading?: boolean;
    title?: string;
    subtitle?: string;
}

const AreaTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-md border-[length:var(--surface-border-width)] border-border backdrop-blur-[var(--surface-blur)] bg-background px-3 py-2 shadow-surface text-sm">
            <p className="font-medium">{label}</p>
            <p className="text-muted-foreground">{payload[0].value} calls</p>
        </div>
    );
};

export function CallVolumeChart({ data, loading, title = "Call Volume", subtitle }: CallVolumeChartProps) {
    const hasData = data.some((d) => d.calls > 0);

    return (
        <Card className="h-full md:flex md:flex-col">
            <ChartHeading title={title} subtitle={subtitle} />
            <CardContent className="px-5 pb-3 md:min-h-0 md:flex-1">
                <div className="h-[180px] md:h-full">
                    {loading ? (
                        <Skeleton className="h-full w-full" />
                    ) : !hasData ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                            <p className="text-sm">No calls in this period</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.35} />
                                    <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                            <XAxis
                                dataKey="date"
                                tickFormatter={fmtDate}
                                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                allowDecimals={false}
                                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip content={<AreaTooltip />} cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }} />
                            <Area isAnimationActive={false}
                                type="monotone"
                                dataKey="calls"
                                stroke="var(--chart-line)"
                                strokeWidth={2.5}
                                fill="url(#areaGrad)"
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Radar Chart (mode / channel breakdown) ──────────────────────────────────

interface BreakdownItem {
    name: string;
    count: number;
}

interface ChannelRadarChartProps {
    data: BreakdownItem[];
    title: string;
    subtitle?: string;
    loading?: boolean;
}

const RadarTooltip = ({ active, payload, unit = "calls" }: { active?: boolean; payload?: Array<{ payload: BreakdownItem }>; unit?: string }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0].payload;
    return (
        <div className="rounded-md border-[length:var(--surface-border-width)] border-border backdrop-blur-[var(--surface-blur)] bg-background px-3 py-2 shadow-surface text-sm">
            <p className="font-medium capitalize">{item.name}</p>
            <p className="text-muted-foreground">{item.count} {unit}</p>
        </div>
    );
};

export function ChannelRadarChart({ data, title, subtitle, loading, unit }: ChannelRadarChartProps & { unit?: string }) {
    const total = data.reduce((s, d) => s + d.count, 0);

    return (
        <Card className="h-full">
            <ChartHeading title={title} subtitle={subtitle} />
            <CardContent className="px-5 pb-5">
                {loading ? (
                    <Skeleton className="h-[320px] w-full" />
                ) : total === 0 ? (
                    <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
                        No data yet
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={320}>
                        <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                            <PolarGrid stroke="var(--chart-grid)" />
                            <PolarAngleAxis dataKey="name" tickSize={14} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                            <PolarRadiusAxis domain={[0, "dataMax"]} axisLine={false} tick={false} />
                            <Tooltip content={<RadarTooltip unit={unit} />} />
                            <Radar isAnimationActive={false}
                                dataKey="count"
                                stroke="var(--chart-line)"
                                fill="var(--chart-line)"
                                fillOpacity={0.35}
                                strokeWidth={2}
                                dot={{ r: 5, fill: "var(--chart-line)", stroke: "var(--background)", strokeWidth: 2 }}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Vertical Bar Chart (top agents) ─────────────────────────────────────────

interface BarItem {
    name: string;
    calls: number;
}

interface TopAgentsBarChartProps {
    data: BarItem[];
    title: string;
    subtitle?: string;
    loading?: boolean;
}

const BarTooltip = ({ active, payload, label, unit = "calls" }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; unit?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-md border-[length:var(--surface-border-width)] border-border backdrop-blur-[var(--surface-blur)] bg-background px-3 py-2 shadow-surface text-sm">
            <p className="font-medium">{label}</p>
            <p className="text-muted-foreground">{payload[0].value} {unit}</p>
        </div>
    );
};

export function TopAgentsBarChart({ data, title, subtitle, loading }: TopAgentsBarChartProps) {
    return (
        <Card className="h-full">
            <ChartHeading title={title} subtitle={subtitle} />
            <CardContent className="px-5 pb-5">
                {loading ? (
                    <Skeleton className="h-[320px] w-full" />
                ) : data.length === 0 ? (
                    <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
                        No data yet
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                            <XAxis
                                dataKey="name"
                                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                                interval={0}
                                angle={data.length > 4 ? -20 : 0}
                                textAnchor={data.length > 4 ? "end" : "middle"}
                                height={data.length > 4 ? 40 : 24}
                            />
                            <YAxis
                                allowDecimals={false}
                                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip content={<BarTooltip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }} />
                            <Bar isAnimationActive={false} dataKey="calls" fill="var(--chart-line)" stroke="var(--border)" strokeWidth={2} radius={0} maxBarSize={48} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Shared frame, palette & tooltip helpers ─────────────────────────────────

// Categorical chart colours come from the active theme, which keeps enough
// tonal separation for adjacent slices and bars.
const PALETTE = [
    "var(--chart-palette-1)",
    "var(--chart-palette-2)",
    "var(--chart-palette-3)",
    "var(--chart-palette-4)",
    "var(--chart-palette-5)",
];

const TOOLTIP_BOX =
    "rounded-md border-[length:var(--surface-border-width)] border-border backdrop-blur-[var(--surface-blur)] bg-background px-3 py-2 shadow-surface text-sm";

function ChartFrame({
    title,
    subtitle,
    loading,
    empty,
    height = 300,
    footer,
    children,
}: {
    title: string;
    subtitle?: string;
    loading?: boolean;
    empty?: boolean;
    height?: number;
    footer?: ReactNode;
    children: React.ReactElement;
}) {
    return (
        <Card className="h-full">
            <ChartHeading title={title} subtitle={subtitle} />
            <CardContent className="px-5 pb-5">
                {loading ? (
                    <Skeleton className="w-full" style={{ height }} />
                ) : empty ? (
                    <div
                        className="flex items-center justify-center text-sm text-muted-foreground"
                        style={{ height }}
                    >
                        No data yet
                    </div>
                ) : (
                    <>
                        <ResponsiveContainer width="100%" height={height}>
                            {children}
                        </ResponsiveContainer>
                        {footer && <div className="mt-3">{footer}</div>}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function LegendRow({ items }: { items: Array<{ name: string; color: string; value: number }> }) {
    return (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {items.map((it) => (
                <span key={it.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
                    <span className="capitalize">{it.name}</span>
                    <span className="font-medium text-foreground">{it.value}</span>
                </span>
            ))}
        </div>
    );
}

// ─── Composed chart: daily calls (bars) + talk-time minutes (line) ────────────

interface DailyDurationPoint {
    date: string;
    calls: number;
    duration?: number;
}

const ComposedTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const calls = payload.find((p) => p.dataKey === "calls")?.value ?? 0;
    const minutes = payload.find((p) => p.dataKey === "minutes")?.value ?? 0;
    return (
        <div className={TOOLTIP_BOX}>
            <p className="font-medium">{label ? fmtDate(label) : ""}</p>
            <p className="text-muted-foreground">{calls} calls</p>
            <p className="text-muted-foreground">{minutes} min talk-time</p>
        </div>
    );
};

export function CallsDurationComposedChart({ data, loading, title, subtitle }: { data: DailyDurationPoint[]; loading?: boolean; title: string; subtitle?: string }) {
    const rows = data.map((d) => ({ date: d.date, calls: d.calls, minutes: Math.round((d.duration ?? 0) / 60) }));
    const empty = !rows.some((d) => d.calls > 0);
    return (
        <ChartFrame title={title} subtitle={subtitle} loading={loading} empty={empty} height={260}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ComposedTooltip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }} />
                <Bar isAnimationActive={false} yAxisId="left" dataKey="calls" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="minutes" stroke="var(--chart-palette-2)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            </ComposedChart>
        </ChartFrame>
    );
}

// ─── Pie / donut: generic {name, count} breakdown ────────────────────────────

interface NameCount {
    name: string;
    count: number;
}

const PieTooltip = ({ active, payload, unit = "calls" }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { name: string } }>; unit?: string }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    return (
        <div className={TOOLTIP_BOX}>
            <p className="font-medium capitalize">{p.payload.name}</p>
            <p className="text-muted-foreground">{p.value} {unit}</p>
        </div>
    );
};

export function PieBreakdownChart({ data, title, subtitle, loading, donut = false, unit }: { data: NameCount[]; title: string; subtitle?: string; loading?: boolean; donut?: boolean; unit?: string }) {
    const total = data.reduce((s, d) => s + d.count, 0);
    const legend = data.map((d, i) => ({ name: d.name, color: PALETTE[i % PALETTE.length], value: d.count }));
    return (
        <ChartFrame title={title} subtitle={subtitle} loading={loading} empty={total === 0} height={260} footer={<LegendRow items={legend} />}>
            <PieChart>
                <Pie isAnimationActive={false}
                    data={data}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={donut ? 62 : 0}
                    outerRadius={100}
                    paddingAngle={data.length > 1 ? 2 : 0}
                    stroke="var(--background)"
                    strokeWidth={data.length > 1 ? 2 : 0}
                >
                    {data.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                </Pie>
                <Tooltip content={<PieTooltip unit={unit} />} />
            </PieChart>
        </ChartFrame>
    );
}

// ─── Radial bar: generic {name, count} (e.g. run-state funnel) ────────────────

export function RadialBreakdownChart({ data, title, subtitle, loading, unit }: { data: NameCount[]; title: string; subtitle?: string; loading?: boolean; unit?: string }) {
    const total = data.reduce((s, d) => s + d.count, 0);
    const rows = data.map((d, i) => ({ ...d, fill: PALETTE[i % PALETTE.length] }));
    const legend = rows.map((d) => ({ name: d.name, color: d.fill, value: d.count }));
    return (
        <ChartFrame title={title} subtitle={subtitle} loading={loading} empty={total === 0} height={260} footer={<LegendRow items={legend} />}>
            <RadialBarChart data={rows} innerRadius="25%" outerRadius="100%" startAngle={90} endAngle={-270}>
                <RadialBar isAnimationActive={false} dataKey="count" background={{ fill: "var(--muted)" }} cornerRadius={6}>
                    {rows.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                </RadialBar>
                <Tooltip content={<PieTooltip unit={unit} />} />
            </RadialBarChart>
        </ChartFrame>
    );
}

// ─── Horizontal bar: ranked {name, calls} ────────────────────────────────────

export function HorizontalBarChart({ data, title, subtitle, loading, unit }: { data: BarItem[]; title: string; subtitle?: string; loading?: boolean; unit?: string }) {
    return (
        <Card className="h-full md:flex md:flex-col">
            <ChartHeading title={title} subtitle={subtitle} />
            <CardContent className="px-5 pb-3 md:min-h-0 md:flex-1">
                <div className="h-[220px] md:h-full">
                    {loading ? (
                        <Skeleton className="h-full w-full" />
                    ) : data.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No data yet
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={data} margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
                                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                                <Tooltip content={<BarTooltip unit={unit} />} cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }} />
                                <Bar isAnimationActive={false} dataKey="calls" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={24}>
                                    <LabelList dataKey="calls" position="right" className="fill-foreground" fontSize={11} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Scatter: agent efficiency (calls vs avg call minutes) ────────────────────

interface AgentPoint {
    name: string;
    calls: number;
    avg_duration: number;
}

const ScatterTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; calls: number; minutes: number } }> }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <div className={TOOLTIP_BOX}>
            <p className="font-medium">{p.name}</p>
            <p className="text-muted-foreground">{p.calls} calls</p>
            <p className="text-muted-foreground">{p.minutes} min avg</p>
        </div>
    );
};

export function AgentScatterChart({ data, title, subtitle, loading }: { data: AgentPoint[]; title: string; subtitle?: string; loading?: boolean }) {
    const rows = data.map((d) => ({ name: d.name, calls: d.calls, minutes: Math.round((d.avg_duration / 60) * 10) / 10 }));
    return (
        <ChartFrame title={title} subtitle={subtitle} loading={loading} empty={rows.length === 0} height={300}>
            <ScatterChart margin={{ top: 12, right: 20, bottom: 4, left: -8 }}>
                <CartesianGrid stroke="var(--chart-grid)" />
                <XAxis type="number" dataKey="calls" name="Calls" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis type="number" dataKey="minutes" name="Avg min" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <ZAxis type="number" dataKey="calls" range={[60, 420]} />
                <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "var(--chart-grid)" }} />
                <Scatter isAnimationActive={false} data={rows} fill="var(--chart-1)" fillOpacity={0.7} stroke="var(--background)" strokeWidth={1} />
            </ScatterChart>
        </ChartFrame>
    );
}

// ─── Vertical bar histogram: calls by hour of day ────────────────────────────

interface HourPoint {
    hour: number;
    calls: number;
}

const HourTooltip = ({ active, payload, label, unit = "calls" }: { active?: boolean; payload?: Array<{ value: number }>; label?: number; unit?: string }) => {
    if (!active || !payload?.length) return null;
    const h = Number(label);
    return (
        <div className={TOOLTIP_BOX}>
            <p className="font-medium">{`${String(h).padStart(2, "0")}:00 – ${String((h + 1) % 24).padStart(2, "0")}:00`}</p>
            <p className="text-muted-foreground">{payload[0].value} {unit}</p>
        </div>
    );
};

export function HourlyBarChart({ data, title, subtitle, loading, unit }: { data: HourPoint[]; title: string; subtitle?: string; loading?: boolean; unit?: string }) {
    const empty = !data.some((d) => d.calls > 0);

    return (
        <Card className="h-full md:flex md:flex-col">
            <ChartHeading title={title} subtitle={subtitle} />
            <CardContent className="px-5 pb-3 md:min-h-0 md:flex-1">
                <div className="h-[240px] md:h-full">
                    {loading ? (
                        <Skeleton className="h-full w-full" />
                    ) : empty ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No data yet
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                                <XAxis dataKey="hour" interval={1} tickFormatter={(h) => String(h)} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                                <Tooltip content={<HourTooltip unit={unit} />} cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }} />
                                <Bar isAnimationActive={false} dataKey="calls" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

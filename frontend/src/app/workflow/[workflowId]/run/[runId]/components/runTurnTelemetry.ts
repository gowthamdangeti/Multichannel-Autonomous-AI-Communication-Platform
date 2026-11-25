// Per-turn numbers exist only where an event recorded them. Tokens, speech and
// cost are stored as call totals, so they have no per-turn value to show here.

export interface TurnTelemetryEvent {
    type: string;
    turn?: number;
    payload?: Record<string, unknown>;
}

export interface TurnTelemetryItem {
    turn: string;
    turnIndex: number;
    apiRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number | null;
    llmLatencyMs: number | null;
    responseLatencyMs: number | null;
    toolCalls: number;
}

interface TurnTally {
    llmLatencies: number[];
    responseLatencies: number[];
    failed: number;
    toolCalls: number;
}

const newTally = (): TurnTally => ({ llmLatencies: [], responseLatencies: [], failed: 0, toolCalls: 0 });

const toMs = (seconds: unknown) => Math.round(Number(seconds) * 1000);

const averageOf = (values: number[]) =>
    values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

function addEvent(tally: TurnTally, event: TurnTelemetryEvent) {
    const payload = event.payload;
    if (event.type === 'rtf-ttfb-metric' && payload?.ttfb_seconds) {
        tally.llmLatencies.push(toMs(payload.ttfb_seconds));
    } else if (event.type === 'rtf-latency-measured' && payload?.latency_seconds) {
        tally.responseLatencies.push(toMs(payload.latency_seconds));
    } else if (event.type === 'rtf-pipeline-error') {
        tally.failed += 1;
    } else if (event.type === 'rtf-function-call-end') {
        tally.toolCalls += 1;
    }
}

export function extractTurnTelemetry(events: TurnTelemetryEvent[]): TurnTelemetryItem[] {
    const tallies = new Map<number, TurnTally>();
    for (const event of events) {
        if (typeof event.turn !== 'number') continue;
        const tally = tallies.get(event.turn) ?? newTally();
        tallies.set(event.turn, tally);
        addEvent(tally, event);
    }

    return [...tallies.entries()]
        .sort(([a], [b]) => a - b)
        .map(([turnIndex, tally]) => {
            const successfulRequests = tally.llmLatencies.length;
            const apiRequests = successfulRequests + tally.failed;
            return {
                turn: `T${turnIndex}`,
                turnIndex,
                apiRequests,
                successfulRequests,
                failedRequests: tally.failed,
                successRate: apiRequests > 0 ? Math.round((successfulRequests / apiRequests) * 100) : null,
                llmLatencyMs: averageOf(tally.llmLatencies),
                responseLatencyMs: averageOf(tally.responseLatencies),
                toolCalls: tally.toolCalls,
            };
        });
}

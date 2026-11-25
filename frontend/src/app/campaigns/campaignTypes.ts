import type { ITimezoneOption } from 'react-timezone-select';

export type TimeSlot = {
    day_of_week: number;
    start_time: string;
    end_time: string;
};

export type ReportVariableItem = {
    name: string;
    type: string;
    description: string;
};

export interface CampaignAdvancedSettingsProps {
    // Concurrency
    maxConcurrency: string;
    onMaxConcurrencyChange: (value: string) => void;
    effectiveLimit: number;
    orgConcurrentLimit: number;
    fromNumbersCount: number;

    // Retry config
    retryEnabled: boolean;
    onRetryEnabledChange: (value: boolean) => void;
    maxRetries: string;
    onMaxRetriesChange: (value: string) => void;
    retryDelaySeconds: string;
    onRetryDelaySecondsChange: (value: string) => void;
    retryOnBusy: boolean;
    onRetryOnBusyChange: (value: boolean) => void;
    retryOnNoAnswer: boolean;
    onRetryOnNoAnswerChange: (value: boolean) => void;
    retryOnVoicemail: boolean;
    onRetryOnVoicemailChange: (value: boolean) => void;

    // Schedule config
    scheduleEnabled: boolean;
    onScheduleEnabledChange: (value: boolean) => void;
    scheduleTimezone: ITimezoneOption | string;
    onScheduleTimezoneChange: (value: ITimezoneOption | string) => void;
    scheduleMode?: 'window' | 'start_at';
    onScheduleModeChange?: (value: 'window' | 'start_at') => void;
    scheduleStartAt?: string;
    onScheduleStartAtChange?: (value: string) => void;
    timeSlots: TimeSlot[];
    onTimeSlotsChange: (value: TimeSlot[]) => void;

    // Circuit breaker config
    circuitBreakerEnabled: boolean;
    onCircuitBreakerEnabledChange: (value: boolean) => void;
    circuitBreakerFailureThreshold: string;
    onCircuitBreakerFailureThresholdChange: (value: string) => void;
    circuitBreakerWindowSeconds: string;
    onCircuitBreakerWindowSecondsChange: (value: string) => void;
    circuitBreakerMinCalls: string;
    onCircuitBreakerMinCallsChange: (value: string) => void;

    // Report template & variables
    reportTemplateEnabled?: boolean;
    onReportTemplateEnabledChange?: (value: boolean) => void;
    reportTemplate?: string;
    onReportTemplateChange?: (value: string) => void;
    reportVariables?: ReportVariableItem[];
    onReportVariablesChange?: (value: ReportVariableItem[]) => void;
    onImportFromWorkflow?: () => void;

    // Rendering mode
    mode?: 'all' | 'controls' | 'report' | 'variables';
}

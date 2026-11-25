import type { WorkflowRunLogs } from '@/components/workflow/conversation';
import type { ConversationCompleteness } from '@/components/workflow/ConversationCompleteness';

import type { ProviderUsage } from './providerUsage';

export type { WorkflowRunLogs };

export interface RealtimeFeedbackEvent {
    type: string;
    turn?: number;
    node_name?: string;
    timestamp?: string;
    payload?: {
        text?: string;
        final?: boolean;
        user_id?: string;
        timestamp?: string;
        function_name?: string;
        tool_call_id?: string;
        node_id?: string;
        node_name?: string;
        duration_seconds?: number;
        ttfb_seconds?: number;
        latency_seconds?: number;
        error?: string;
        fatal?: boolean;
        processor?: string;
        code?: string;
        exception_type?: string;
        status?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface WorkflowRunResponse {
    id?: number | string | null;
    run_id?: number | string | null;
    workflow_id?: number;
    workflow_uuid?: string | null;
    agent_uuid?: string | null;
    name?: string | null;
    conversation_title?: string | null;
    workflow_name?: string | null;
    account_holder?: string | null;
    organization_name?: string | null;
    platform_model_configuration_id?: number | string | null;
    mode: string;
    call_type?: string | null;
    is_completed: boolean;
    disposition?: string | null;
    created_at?: string | null;
    transcript_url: string | null;
    recording_url: string | null;
    user_recording_url: string | null;
    bot_recording_url: string | null;
    cost_info: {
        autonomous_ai_os_token_usage?: number | null;
        call_duration_seconds?: number | null;
        charge_usd?: number | null;
    } | null;
    usage_info?: {
        llm?: Record<string, {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        }>;
        tts?: Record<string, number>;
        stt?: Record<string, number>;
        call_duration_seconds?: number | null;
    } | null;
    initial_context?: Record<string, string | number | boolean | object> | null;
    gathered_context?: Record<string, string | number | boolean | object> | null;
    runtime_configuration?: Record<string, unknown> | null;
    preset_name?: string | null;
    model_preset_name?: string | null;
    preset?: { name?: string | null; [key: string]: unknown } | null;
    workflow?: { preset_name?: string | null; workflow_uuid?: string | null; [key: string]: unknown } | null;
    logs?: WorkflowRunLogs | null;
    annotations?: Record<string, unknown> | null;
    report_s3_key?: string | null;
    report_generation_status?: string | null;
    has_report_template?: boolean;
    completeness?: ConversationCompleteness | null;
    canonical_usage?: { entries: Record<string, unknown>[]; provider_usage?: ProviderUsage | null } | null;
    [key: string]: unknown;
}

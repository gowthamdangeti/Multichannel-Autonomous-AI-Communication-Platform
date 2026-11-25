import type { ITimezoneOption } from 'react-timezone-select';

export interface ReportVariableItem {
    name: string;
    type: string;
    description: string;
}

export const DEFAULT_REPORT_VARIABLE_ITEMS: ReportVariableItem[] = [
    { name: "campaign_name", type: "text", description: "Return the exact campaign name from the campaign configuration. Do not modify, summarize, or invent a campaign name." },
    { name: "campaign_id", type: "text", description: "Return the unique campaign identifier exactly as provided in the campaign data. Example format: CMP-10492." },
    { name: "campaign_description", type: "text", description: "Generate a concise and professional campaign description in 1–3 sentences. Explain the purpose of the campaign, target audience, and primary objective without performance statistics." },
    { name: "campaign_status", type: "text", description: "Return the current or final campaign status exactly from campaign data (Draft, Scheduled, Running, Paused, Completed, Cancelled, Failed)." },
    { name: "campaign_type", type: "text", description: "Return a short category describing the campaign purpose (Loan Repayment, Lead Qualification, Customer Survey, Payment Reminder, Appointment Reminder, Customer Follow-Up)." },
    { name: "agent_name", type: "text", description: "Return the exact name of the AI agent assigned to execute the campaign calls." },
    { name: "provider", type: "text", description: "Return the telephony provider used for the campaign (Twilio, Plivo, Telnyx, etc.)." },
    { name: "started_at", type: "text", description: "Return the date and time when campaign execution started (Prefer ISO-8601 format)." },
    { name: "completed_at", type: "text", description: "Return the campaign completion date and time in ISO-8601 format or null if incomplete." },
    { name: "total_targets", type: "number", description: "Return total number of unique targets or contacts included in the campaign." },
    { name: "total_calls", type: "number", description: "Return total number of call attempts made during the campaign including retries." },
    { name: "connected_calls", type: "number", description: "Count call attempts where a successful connection with the contact was established." },
    { name: "completed_calls", type: "number", description: "Count calls where the intended conversation flow reached a completed outcome." },
    { name: "not_connected_calls", type: "number", description: "Count calls where no customer conversation was established (no answer, busy, unreachable, voicemail)." },
    { name: "failed_calls", type: "number", description: "Count calls that failed because of technical, provider, system, or telephony errors." },
    { name: "connection_rate", type: "number", description: "Percentage of total call attempts that successfully connected: (connected_calls / total_calls) * 100." },
    { name: "completion_rate", type: "number", description: "Percentage of total call attempts that reached a completed conversation outcome: (completed_calls / total_calls) * 100." },
    { name: "average_call_duration", type: "text", description: "Average duration of campaign calls in human-readable format such as 2m 14s." },
    { name: "retry_calls", type: "number", description: "Total number of calls that were retry attempts rather than initial attempts." },
    { name: "objective_completed_count", type: "number", description: "Count targets for whom the primary campaign objective was successfully completed." },
    { name: "follow_up_required_count", type: "number", description: "Count unique targets whose final result indicates additional action or future contact is required." },
    { name: "callback_requested_count", type: "number", description: "Count unique targets who explicitly requested another call at a later date or time." },
    { name: "call_dispositions", type: "list", description: "Key-value dictionary containing each final call disposition and its total occurrence count." },
    { name: "target_results", type: "list", description: "Array of structured objects for each campaign target with individual call results." },
    { name: "follow_up_contacts", type: "list", description: "Array of contact objects requiring follow-up or callback." },
    { name: "campaign_summary", type: "text", description: "Generate a concise professional executive summary of the campaign in 2–4 sentences based strictly on provided campaign statistics." },
    { name: "key_findings", type: "list", description: "Generate 3 to 5 concise key findings formatted as short bullet points based strictly on campaign results." },
    { name: "recommended_next_actions", type: "list", description: "Generate 2 to 5 concise operational next actions formatted as short bullet points directly supported by campaign results." },

    // Target Object Variables
    { name: "target.customer_name", type: "text", description: "Customer's or contact's name exactly as provided." },
    { name: "target.phone_number", type: "text", description: "Phone number associated with the campaign target." },
    { name: "target.call_status", type: "text", description: "Technical status of the call (completed, answered, failed, busy, no_answer, cancelled)." },
    { name: "target.call_disposition", type: "text", description: "Final business outcome of the call." },
    { name: "target.objective_status", type: "text", description: "Status of the primary campaign objective for this target (completed, pending, failed, declined)." },
    { name: "target.call_duration", type: "text", description: "Call duration in human-readable format such as 1m 42s." },
    { name: "target.follow_up_required", type: "yes_no", description: "True when additional action or future contact is required for this target." },
    { name: "target.callback_requested", type: "yes_no", description: "True when customer explicitly requested another call." },
    { name: "target.next_action", type: "text", description: "Generate one concise next action for this campaign target based only on individual call result." },

    // Follow-Up Contact Variables
    { name: "contact.customer_name", type: "text", description: "Name of customer requiring follow-up." },
    { name: "contact.phone_number", type: "text", description: "Customer's phone number." },
    { name: "contact.follow_up_reason", type: "text", description: "Generate a concise reason explaining why this customer requires follow-up." },
    { name: "contact.callback_at", type: "text", description: "Customer's requested callback date and time in ISO-8601 format or null." },
    { name: "contact.next_action", type: "text", description: "Generate one concise operational action for this follow-up contact based on recorded call outcome." }
];

export const SYSTEM_TEMPLATE_TAGS = new Set([
    'run_id',
    'phone_number',
    'call_disposition',
    'call_duration',
    'created_at',
    'extracted_variables',
    'contact_id',
    'status',
    'target',
    'contact',
    'disposition',
    'count',
]);

/** Extract string timezone value from ITimezoneOption | string */
export function getTimezoneValue(tz: ITimezoneOption | string): string {
    return typeof tz === 'string' ? tz : tz.value;
}

/** Extract custom Jinja variables from HTML template text excluding system tags */
export function extractJinjaVariables(templateText: string): string[] {
    if (!templateText) return [];
    const matches = templateText.match(/\{\{\s*([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+)*(?:\s*\|.*?)?\s*\}\}/g);
    if (!matches) return [];

    const foundVars = new Set<string>();
    for (const match of matches) {
        const inner = match.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
        const varName = inner.split('|')[0].trim().split('.')[0].trim();
        if (varName && !SYSTEM_TEMPLATE_TAGS.has(varName.toLowerCase())) {
            foundVars.add(varName);
        }
    }
    return Array.from(foundVars);
}

export const DEFAULT_CAMPAIGN_REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>{{ campaign_name | default("Campaign Report") }}</title>

    <style>
        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            padding: 0;
        }

        body {
            padding: 40px 24px;
            font-family: Inter, Arial, Helvetica, sans-serif;
            background: #f4f6f8;
            color: #1f2937;
            line-height: 1.5;
        }

        .report-wrapper {
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
        }

        .report-header {
            padding: 36px 40px;
            background: #111827;
            color: #ffffff;
        }

        .report-header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 30px;
        }

        .report-header-content {
            flex: 1;
            min-width: 0;
        }

        .report-title {
            margin: 0;
            font-size: 30px;
            font-weight: 700;
            line-height: 1.25;
            letter-spacing: -0.4px;
            color: #ffffff;
        }

        .report-subtitle {
            margin-top: 8px;
            font-size: 14px;
            font-weight: 500;
            color: #d1d5db;
        }

        .report-description {
            max-width: 780px;
            margin-top: 13px;
            font-size: 13px;
            line-height: 1.65;
            color: #d1d5db;
        }

        .status-badge {
            display: inline-block;
            padding: 8px 14px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.12);
            color: #ffffff;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
        }

        .report-content {
            padding: 38px 40px 42px;
        }

        .section {
            margin-bottom: 42px;
        }

        .section:last-child {
            margin-bottom: 0;
        }

        .section-header {
            margin-bottom: 18px;
            padding-bottom: 11px;
            border-bottom: 1px solid #e5e7eb;
        }

        .section-title {
            margin: 0;
            color: #111827;
            font-size: 18px;
            font-weight: 700;
        }

        .section-description {
            margin-top: 5px;
            color: #6b7280;
            font-size: 13px;
            line-height: 1.5;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 16px;
        }

        .info-card {
            min-width: 0;
            padding: 18px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #ffffff;
        }

        .info-label {
            margin-bottom: 7px;
            color: #6b7280;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }

        .info-value {
            color: #111827;
            font-size: 14px;
            font-weight: 600;
            overflow-wrap: anywhere;
        }

        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 16px;
        }

        .kpi-card {
            position: relative;
            min-width: 0;
            padding: 20px;
            border: 1px solid #e5e7eb;
            border-radius: 14px;
            background: #ffffff;
            overflow: hidden;
        }

        .kpi-card::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 4px;
            background: #111827;
        }

        .kpi-label {
            color: #6b7280;
            font-size: 12px;
            font-weight: 600;
        }

        .kpi-value {
            margin-top: 8px;
            color: #111827;
            font-size: 27px;
            font-weight: 700;
            line-height: 1.2;
            letter-spacing: -0.4px;
            overflow-wrap: anywhere;
        }

        .kpi-note {
            margin-top: 6px;
            color: #9ca3af;
            font-size: 11px;
            line-height: 1.4;
        }

        .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
        }

        .summary-card {
            min-width: 0;
            padding: 20px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #fafafa;
        }

        .summary-card-title {
            color: #6b7280;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .summary-card-value {
            margin-top: 8px;
            color: #111827;
            font-size: 25px;
            font-weight: 700;
        }

        .table-wrapper {
            width: 100%;
            overflow-x: auto;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #ffffff;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            background: #ffffff;
            font-size: 13px;
        }

        thead {
            background: #f9fafb;
        }

        th {
            padding: 13px 14px;
            border-bottom: 1px solid #e5e7eb;
            color: #4b5563;
            font-size: 10px;
            font-weight: 700;
            text-align: left;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
        }

        td {
            padding: 14px;
            border-bottom: 1px solid #eef0f2;
            color: #374151;
            vertical-align: top;
        }

        tbody tr:last-child td {
            border-bottom: none;
        }

        tbody tr:hover {
            background: #fafafa;
        }

        .target-table-wrapper {
            width: 100%;
            overflow-x: auto;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #ffffff;
        }

        .target-results-table {
            width: 100%;
            min-width: 1050px;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 12px;
        }

        .target-results-table th {
            padding: 11px 9px;
            font-size: 9px;
            white-space: normal;
            overflow-wrap: anywhere;
        }

        .target-results-table td {
            padding: 11px 9px;
            line-height: 1.4;
            white-space: normal;
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .target-results-table .col-customer { width: 13%; }
        .target-results-table .col-phone { width: 12%; }
        .target-results-table .col-status { width: 9%; }
        .target-results-table .col-disposition { width: 13%; }
        .target-results-table .col-objective { width: 12%; }
        .target-results-table .col-duration { width: 8%; }
        .target-results-table .col-followup { width: 8%; }
        .target-results-table .col-callback { width: 8%; }
        .target-results-table .col-action { width: 17%; }

        .badge {
            display: inline-block;
            max-width: 100%;
            padding: 5px 9px;
            border-radius: 999px;
            background: #f3f4f6;
            color: #374151;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.3;
            white-space: normal;
            overflow-wrap: anywhere;
        }

        .content-box {
            padding: 20px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #fafafa;
            color: #374151;
            font-size: 13px;
            line-height: 1.7;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .highlight-box {
            padding: 20px;
            border: 1px solid #e5e7eb;
            border-left: 4px solid #111827;
            border-radius: 8px;
            background: #f9fafb;
            color: #374151;
            font-size: 13px;
            line-height: 1.7;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .empty-state {
            padding: 28px;
            border: 1px dashed #d1d5db;
            border-radius: 12px;
            background: #fafafa;
            color: #6b7280;
            font-size: 13px;
            text-align: center;
        }

        .report-footer {
            padding: 20px 40px;
            border-top: 1px solid #e5e7eb;
            background: #f9fafb;
            color: #6b7280;
            font-size: 11px;
            text-align: center;
        }
    </style>
</head>

<body>

<div class="report-wrapper">

    <header class="report-header">
        <div class="report-header-top">
            <div class="report-header-content">
                <h1 class="report-title">
                    {{ campaign_name | default("Campaign Report") }}
                </h1>
                <div class="report-subtitle">
                    Campaign Performance &amp; Outcome Report
                    {% if campaign_id %}
                        • {{ campaign_id }}
                    {% endif %}
                </div>
                {% if campaign_description %}
                <div class="report-description">
                    {{ campaign_description }}
                </div>
                {% endif %}
            </div>
            <div>
                <span class="status-badge">
                    {{ campaign_status | default("Status N/A") }}
                </span>
            </div>
        </div>
    </header>

    <main class="report-content">
        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Campaign Overview</h2>
                <div class="section-description">Core campaign configuration and execution information.</div>
            </div>
            <div class="info-grid">
                <div class="info-card">
                    <div class="info-label">Campaign ID</div>
                    <div class="info-value">{{ campaign_id | default("N/A") }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Campaign Type</div>
                    <div class="info-value">{{ campaign_type | default("N/A") }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Agent Name</div>
                    <div class="info-value">{{ agent_name | default("N/A") }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Telephony Provider</div>
                    <div class="info-value">{{ provider | default("N/A") }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Started At</div>
                    <div class="info-value">{{ started_at | default("N/A") }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Completed At</div>
                    <div class="info-value">{{ completed_at | default("N/A") }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Total Targets</div>
                    <div class="info-value">{{ total_targets | default(0) }}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Total Call Attempts</div>
                    <div class="info-value">{{ total_calls | default(0) }}</div>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Campaign Performance</h2>
                <div class="section-description">Calling performance and overall campaign execution metrics.</div>
            </div>
            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label">Connected Calls</div>
                    <div class="kpi-value">{{ connected_calls | default(0) }}</div>
                    <div class="kpi-note">Successfully connected calls</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Completed Calls</div>
                    <div class="kpi-value">{{ completed_calls | default(0) }}</div>
                    <div class="kpi-note">Calls reaching completion</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Not Connected</div>
                    <div class="kpi-value">{{ not_connected_calls | default(0) }}</div>
                    <div class="kpi-note">Calls without customer connection</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Failed Calls</div>
                    <div class="kpi-value">{{ failed_calls | default(0) }}</div>
                    <div class="kpi-note">Technical or provider failures</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Connection Rate</div>
                    <div class="kpi-value">{{ connection_rate | default(0) }}%</div>
                    <div class="kpi-note">Connected calls / total call attempts</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Completion Rate</div>
                    <div class="kpi-value">{{ completion_rate | default(0) }}%</div>
                    <div class="kpi-note">Completed calls / total call attempts</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Average Duration</div>
                    <div class="kpi-value">{{ average_call_duration | default("0s") }}</div>
                    <div class="kpi-note">Average campaign call duration</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Retry Calls</div>
                    <div class="kpi-value">{{ retry_calls | default(0) }}</div>
                    <div class="kpi-note">Additional retry attempts</div>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Campaign Outcomes</h2>
                <div class="section-description">High-level objective, follow-up, and callback results.</div>
            </div>
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="summary-card-title">Objective Completed</div>
                    <div class="summary-card-value">{{ objective_completed_count | default(0) }}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-card-title">Follow-Up Required</div>
                    <div class="summary-card-value">{{ follow_up_required_count | default(0) }}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-card-title">Callback Requested</div>
                    <div class="summary-card-value">{{ callback_requested_count | default(0) }}</div>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Call Disposition Analysis</h2>
                <div class="section-description">Distribution of final call outcomes across the campaign.</div>
            </div>
            {% if call_dispositions %}
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Call Disposition</th>
                            <th>Total Calls</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for disposition, count in call_dispositions.items() %}
                        <tr>
                            <td><span class="badge">{{ disposition }}</span></td>
                            <td>{{ count }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            {% else %}
            <div class="empty-state">No call disposition information is available.</div>
            {% endif %}
        </section>

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Campaign Target Results</h2>
                <div class="section-description">Individual call results and required actions for each campaign target.</div>
            </div>
            {% if target_results %}
            <div class="target-table-wrapper">
                <table class="target-results-table">
                    <colgroup>
                        <col class="col-customer">
                        <col class="col-phone">
                        <col class="col-status">
                        <col class="col-disposition">
                        <col class="col-objective">
                        <col class="col-duration">
                        <col class="col-followup">
                        <col class="col-callback">
                        <col class="col-action">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Call Status</th>
                            <th>Disposition</th>
                            <th>Objective Status</th>
                            <th>Duration</th>
                            <th>Follow-Up</th>
                            <th>Callback</th>
                            <th>Next Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for target in target_results %}
                        <tr>
                            <td>{{ target.customer_name | default("N/A") }}</td>
                            <td>{{ target.phone_number | default("N/A") }}</td>
                            <td><span class="badge">{{ target.call_status | default("N/A") }}</span></td>
                            <td><span class="badge">{{ target.call_disposition | default("N/A") }}</span></td>
                            <td>{{ target.objective_status | default("N/A") }}</td>
                            <td>{{ target.call_duration | default("N/A") }}</td>
                            <td>{% if target.follow_up_required %}Yes{% else %}No{% endif %}</td>
                            <td>{% if target.callback_requested %}Yes{% else %}No{% endif %}</td>
                            <td>{{ target.next_action | default("N/A") }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            {% else %}
            <div class="empty-state">No individual campaign target results are available.</div>
            {% endif %}
        </section>

        {% if follow_up_contacts %}
        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Follow-Up Queue</h2>
                <div class="section-description">Campaign targets requiring additional action or future contact.</div>
            </div>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Follow-Up Reason</th>
                            <th>Callback Date &amp; Time</th>
                            <th>Next Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for contact in follow_up_contacts %}
                        <tr>
                            <td>{{ contact.customer_name | default("N/A") }}</td>
                            <td>{{ contact.phone_number | default("N/A") }}</td>
                            <td>{{ contact.follow_up_reason | default("N/A") }}</td>
                            <td>{{ contact.callback_at | default("N/A") }}</td>
                            <td>{{ contact.next_action | default("N/A") }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
        </section>
        {% endif %}

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Executive Summary</h2>
                <div class="section-description">Overall campaign performance, engagement, and outcome summary.</div>
            </div>
            <div class="highlight-box">
                {{ campaign_summary | default("No campaign summary available.") }}
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Key Findings</h2>
                <div class="section-description">Important observations and patterns identified from campaign results.</div>
            </div>
            <div class="content-box">
                {{ key_findings | default("No key findings available.") }}
            </div>
        </section>

        <section class="section">
            <div class="section-header">
                <h2 class="section-title">Recommended Next Actions</h2>
                <div class="section-description">Recommended operational actions based on campaign outcomes.</div>
            </div>
            <div class="content-box">
                {{ recommended_next_actions | default("No recommended actions available.") }}
            </div>
        </section>
    </main>

    <footer class="report-footer">
        Generated Campaign Report
        {% if campaign_name %}
            • {{ campaign_name }}
        {% endif %}
        {% if campaign_id %}
            • {{ campaign_id }}
        {% endif %}
    </footer>
</div>

</body>
</html>
`;

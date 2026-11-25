from api.db.agent_trigger_client import AgentTriggerClient
from api.db.api_key_client import APIKeyClient
from api.db.campaign_client import CampaignClient
from api.db.chat_agent_client import ChatAgentClient
from api.db.chat_agent_overview_client import ChatAgentOverviewClient
from api.db.chat_conversation_client import ChatConversationClient
from api.db.embed_token_client import EmbedTokenClient
from api.db.folder_client import FolderClient
from api.db.integration_client import IntegrationClient
from api.db.knowledge_base_client import KnowledgeBaseClient
from api.db.lead_client import LeadClient
from api.db.organization_client import OrganizationClient
from api.db.organization_configuration_client import OrganizationConfigurationClient
from api.db.organization_usage_client import OrganizationUsageClient
from api.db.reports_client import ReportsClient
from api.db.scheduled_call_client import ScheduledCallClient
from api.db.telephony_configuration_client import TelephonyConfigurationClient
from api.db.telephony_phone_number_client import TelephonyPhoneNumberClient
from api.db.whatsapp_agent_client import WhatsAppAgentClient
from api.db.whatsapp_agent_overview_client import WhatsAppAgentOverviewClient
from api.db.whatsapp_conversation_client import WhatsAppConversationClient
from api.db.whatsapp_number_client import WhatsAppNumberClient
from api.db.tool_client import ToolClient
from api.db.user_client import UserClient
from api.db.webhook_credential_client import WebhookCredentialClient
from api.db.workflow_client import WorkflowClient
from api.db.workflow_recording_client import WorkflowRecordingClient
from api.db.workflow_run_client import WorkflowRunClient
from api.db.workflow_run_text_session_client import WorkflowRunTextSessionClient
from api.db.workflow_template_client import WorkflowTemplateClient
from api.db.usage_event_client import UsageEventClient
from api.db.voice_agent_overview_client import VoiceAgentOverviewClient
from api.db.team_client import TeamClient

class DBClient(
    TeamClient,
    UsageEventClient,
    WorkflowClient,
    WorkflowRunClient,
    WorkflowRunTextSessionClient,
    ScheduledCallClient,
    UserClient,
    OrganizationClient,
    OrganizationConfigurationClient,
    OrganizationUsageClient,
    IntegrationClient,
    WorkflowTemplateClient,
    CampaignClient,
    ReportsClient,
    VoiceAgentOverviewClient,
    ChatAgentOverviewClient,
    WhatsAppAgentOverviewClient,
    APIKeyClient,
    EmbedTokenClient,
    AgentTriggerClient,
    WebhookCredentialClient,
    ToolClient,
    KnowledgeBaseClient,
    WorkflowRecordingClient,
    TelephonyConfigurationClient,
    TelephonyPhoneNumberClient,
    WhatsAppNumberClient,
    WhatsAppAgentClient,
    WhatsAppConversationClient,
    ChatAgentClient,
    ChatConversationClient,
    FolderClient,
    LeadClient,
):
    """
    Unified database client that combines all specialized database operations.

    This client inherits from:
    - WorkflowClient: handles workflow and workflow definition operations
    - WorkflowRunClient: handles workflow run operations
    - UserClient: handles user and user configuration operations
    - OrganizationClient: handles organization operations
    - OrganizationConfigurationClient: handles organization configuration operations
    - OrganizationUsageClient: handles organization usage reporting aggregates
    - IntegrationClient: handles integration operations
    - WorkflowTemplateClient: handles workflow template operations
    - CampaignClient: handles campaign operations
    - ReportsClient: handles reports and analytics operations
    - VoiceAgentOverviewClient: handles grouped voice-call reads for the overview page
    - ChatAgentOverviewClient: handles grouped website-chat reads for the overview page
    - WhatsAppAgentOverviewClient: handles grouped WhatsApp thread reads for the overview page
    - APIKeyClient: handles API key operations
    - EmbedTokenClient: handles embed token and session operations
    - AgentTriggerClient: handles agent trigger operations for API-based call triggering
    - WebhookCredentialClient: handles webhook credential operations
    - ToolClient: handles tool operations for reusable HTTP API tools
    - KnowledgeBaseClient: handles knowledge base document and vector search operations
    - FolderClient: handles folder operations for grouping workflows (agents)
    """

    pass

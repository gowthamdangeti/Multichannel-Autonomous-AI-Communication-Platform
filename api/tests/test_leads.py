"""Contract tests for in-house leads (no DB required)."""

from api.schemas.leads import EnterpriseLeadCreate, OnboardingProfileCreate


def test_enterprise_lead_camelcase_aliases():
    lead = EnterpriseLeadCreate.model_validate(
        {
            "name": "Asha",
            "company": "Acme",
            "jobTitle": "VP Ops",
            "workEmail": "asha@acme.com",
            "phone": "+911234567890",
            "volume": "5k-100k",
            "deployment": "yes",
            "agentGoal": "support",
            "source": "landing_contact",
            "origin": "oss_app",
        }
    )
    assert lead.work_email == "asha@acme.com"
    assert lead.job_title == "VP Ops"
    assert lead.agent_goal == "support"


def test_onboarding_profile_aliases():
    profile = OnboardingProfileCreate.model_validate(
        {
            "email": "user@acme.com",
            "persona": "enterprise_midmarket",
            "onPremNeed": "yes",
            "migratingFrom": "vapi",
            "howHeard": "github",
            "volume": "0-5k",
        }
    )
    assert profile.onprem_need == "yes"
    assert profile.migrating_from == "vapi"
    assert profile.how_heard == "github"

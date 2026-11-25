from api.services.workflow.template_generation import (
    find_missing_global_template_variables,
)
from api.services.workflow.workflow_graph import extract_template_variables


def _workflow(global_prompt: str, extra_nodes: list[dict] | None = None) -> dict:
    return {
        "nodes": [
            {
                "id": "global",
                "type": "globalNode",
                "data": {"name": "Global Context", "prompt": global_prompt},
            },
            *(extra_nodes or []),
        ],
        "edges": [],
    }


def test_generated_global_prompt_can_preserve_all_required_variables():
    required = {
        "business_name",
        "contact_name",
        "merchant_phone",
        "merchant_address",
        "merchant_state",
        "merchant_status",
        "merchant_processor",
        "merchant_notes",
    }
    generated_prompt = """You are a merchant follow-up representative.
Use this current call context:
Contact: {{contact_name}}
Business: {{business_name}}
Phone: {{merchant_phone}}
Address: {{merchant_address}}
State: {{merchant_state}}
Status: {{merchant_status}}
Processor: {{merchant_processor}}
Notes: {{merchant_notes}}
Never claim provided context is unavailable.
"""

    missing = find_missing_global_template_variables(
        _workflow(generated_prompt), required
    )

    assert missing == []
    assert generated_prompt != "merchant follow-up representative"


def test_validation_reports_exact_variables_missing_from_global_prompt():
    definition = _workflow("Contact: {{contact_name}}")

    missing = find_missing_global_template_variables(
        definition, {"contact_name", "business_name", "merchant_phone"}
    )

    assert missing == ["business_name", "merchant_phone"]


def test_variable_in_another_node_does_not_satisfy_global_prompt_contract():
    definition = _workflow(
        "Be helpful and concise.",
        extra_nodes=[
            {
                "id": "start",
                "type": "startCall",
                "data": {
                    "name": "Start",
                    "prompt": "Greet {{contact_name}}.",
                },
            }
        ],
    )

    assert find_missing_global_template_variables(
        definition, {"contact_name"}
    ) == ["contact_name"]


def test_source_variable_extraction_keeps_existing_exclusion_rules():
    description = """
Customer: {{customer_name}}
Nested runtime value: {{initial_context.account_id}}
System value: {{provider}}
Optional value: {{nickname | fallback:friend}}
"""

    assert extract_template_variables(description) == {"customer_name"}


def test_workflow_without_required_variables_needs_no_global_placeholders():
    definition = _workflow("You are a concise appointment assistant.")

    assert find_missing_global_template_variables(definition, set()) == []

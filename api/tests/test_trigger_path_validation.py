from api.services.workflow.trigger_paths import (
    TRIGGER_PATH_MAX_LENGTH,
    ensure_trigger_paths,
    extract_trigger_paths,
    validate_trigger_paths,
)


def test_validate_trigger_paths_rejects_invalid_path_segments():
    workflow_definition = {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "data": {"trigger_path": "support/west"},
            }
        ],
        "edges": [],
    }

    issues = validate_trigger_paths(workflow_definition)

    assert len(issues) == 1
    assert issues[0].node_id == "trigger-1"
    assert "single URL path segment" in issues[0].message


def test_validate_trigger_paths_rejects_long_and_duplicate_paths():
    long_path = "a" * (TRIGGER_PATH_MAX_LENGTH + 1)
    workflow_definition = {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "data": {"trigger_path": long_path},
            },
            {
                "id": "trigger-2",
                "type": "trigger",
                "data": {"trigger_path": "sales_agent"},
            },
            {
                "id": "trigger-3",
                "type": "trigger",
                "data": {"trigger_path": "sales_agent"},
            },
        ],
        "edges": [],
    }

    issues = validate_trigger_paths(workflow_definition)
    messages = [issue.message for issue in issues]

    assert (
        f"Trigger path must be {TRIGGER_PATH_MAX_LENGTH} characters or fewer."
        in messages
    )
    assert "Trigger path is duplicated in this workflow." in messages


def test_retrigger_paths_share_trigger_validation_and_generation():
    workflow_definition = {
        "nodes": [
            {"id": "api", "type": "trigger", "data": {"trigger_path": "api"}},
            {"id": "later", "type": "retrigger", "data": {}},
        ],
        "edges": [],
    }

    updated = ensure_trigger_paths(workflow_definition)
    paths = extract_trigger_paths(updated)

    assert paths[0] == "api"
    assert len(paths) == 2
    assert updated["nodes"][1]["data"]["trigger_path"] == paths[1]
    assert validate_trigger_paths(updated) == []


def test_retrigger_path_conflicts_with_api_trigger_path():
    workflow_definition = {
        "nodes": [
            {"id": "api", "type": "trigger", "data": {"trigger_path": "shared"}},
            {"id": "later", "type": "retrigger", "data": {"trigger_path": "shared"}},
        ],
        "edges": [],
    }

    issues = validate_trigger_paths(workflow_definition)

    assert [issue.message for issue in issues] == [
        "Trigger path is duplicated in this workflow."
    ]

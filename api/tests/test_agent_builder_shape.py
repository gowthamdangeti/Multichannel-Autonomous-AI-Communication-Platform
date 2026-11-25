import copy

import pytest

from api.services.workflow.template_generation import validate_builder_shape


def _valid_workflow() -> dict:
    return {
        "nodes": [
            {"id": "global", "type": "globalNode", "data": {}},
            {"id": "start", "type": "startCall", "data": {}},
            {"id": "agenda", "type": "agentNode", "data": {}},
            {"id": "end", "type": "endCall", "data": {}},
        ],
        "edges": [
            {"id": "start-agenda", "source": "start", "target": "agenda"},
            {"id": "start-end", "source": "start", "target": "end"},
            {"id": "agenda-end", "source": "agenda", "target": "end"},
        ],
    }


def test_accepts_exact_conditional_triangle():
    validate_builder_shape(_valid_workflow())


def test_rejects_extra_agent_node():
    workflow = _valid_workflow()
    workflow["nodes"].append({"id": "agenda-2", "type": "agentNode", "data": {}})

    with pytest.raises(ValueError, match="agentNode=2"):
        validate_builder_shape(workflow)


def test_rejects_second_end_node():
    workflow = _valid_workflow()
    workflow["nodes"].append({"id": "end-2", "type": "endCall", "data": {}})

    with pytest.raises(ValueError, match="endCall=2"):
        validate_builder_shape(workflow)


def test_rejects_old_linear_chain_without_early_exit():
    workflow = _valid_workflow()
    workflow["edges"] = [
        edge for edge in workflow["edges"] if edge["id"] != "start-end"
    ]

    with pytest.raises(ValueError, match="Start Call -> End Call"):
        validate_builder_shape(workflow)


def test_rejects_missing_main_agenda_entry_path():
    workflow = _valid_workflow()
    workflow["edges"] = [
        edge for edge in workflow["edges"] if edge["id"] != "start-agenda"
    ]

    with pytest.raises(ValueError, match="Start Call -> Main Agenda"):
        validate_builder_shape(workflow)


def test_rejects_missing_main_agenda_completion_path():
    workflow = _valid_workflow()
    workflow["edges"] = [
        edge for edge in workflow["edges"] if edge["id"] != "agenda-end"
    ]

    with pytest.raises(ValueError, match="Main Agenda -> End Call"):
        validate_builder_shape(workflow)


def test_rejects_additional_edge():
    workflow = _valid_workflow()
    workflow["edges"].append(
        {"id": "end-start", "source": "end", "target": "start"}
    )

    with pytest.raises(ValueError, match="additional, reverse"):
        validate_builder_shape(workflow)


def test_rejects_reverse_edge_replacing_required_edge():
    workflow = _valid_workflow()
    workflow["edges"][0] = {
        "id": "agenda-start",
        "source": "agenda",
        "target": "start",
    }

    with pytest.raises(ValueError, match="reverse"):
        validate_builder_shape(workflow)


def test_rejects_edge_involving_global_node():
    workflow = copy.deepcopy(_valid_workflow())
    workflow["edges"][0] = {
        "id": "global-agenda",
        "source": "global",
        "target": "agenda",
    }

    with pytest.raises(ValueError, match="Global Node edges"):
        validate_builder_shape(workflow)

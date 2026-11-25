from api.db.models import ScheduledWorkflowCallModel


def test_scheduled_call_model_has_tenant_idempotency_and_due_index():
    table = ScheduledWorkflowCallModel.__table__

    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    indexes = {index.name: tuple(column.name for column in index.columns) for index in table.indexes}

    assert ("organization_id", "idempotency_key") in unique_columns
    assert indexes["ix_scheduled_workflow_calls_due"] == ("status", "next_attempt_at")


def test_scheduled_call_model_stores_dispatch_lifecycle_fields():
    columns = ScheduledWorkflowCallModel.__table__.columns

    assert columns["scheduled_at"].nullable is False
    assert columns["next_attempt_at"].nullable is False
    assert columns["target_workflow_id"].nullable is False
    assert columns["phone_number"].nullable is False
    assert columns["initial_context"].nullable is False
    assert columns["attempt_count"].nullable is False
    assert columns["max_attempts"].nullable is False
    assert columns["retry_strategy"].nullable is False
    assert columns["retry_interval_seconds"].nullable is False
    assert columns["dispatched_workflow_run_id"].nullable is True

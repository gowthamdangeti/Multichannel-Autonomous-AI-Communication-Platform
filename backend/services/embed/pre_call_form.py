"""Resolve and validate visitor-facing pre-call forms for workflow embeds."""

from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from api.schemas.embed import (
    PRE_CALL_FIELD_TYPES,
    PRE_CALL_VARIABLE_NAME_PATTERN,
    PreCallFormSettings,
    PublicPreCallForm,
    PublicPreCallFormField,
)
from api.services.workflow.dto import ReactFlowDTO
from api.services.workflow.workflow_graph import WorkflowGraph


@dataclass
class ResolvedPreCallField:
    name: str
    label: str
    type: str
    required: bool
    editable: bool
    has_value: bool
    value: Any = None
    placeholder: str | None = None
    max_length: int | None = None
    options: list[str] | None = None
    order: int = 0


@dataclass
class ResolvedPreCallForm:
    enabled: bool
    title: str
    description: str | None
    submit_label: str
    always_show: bool
    show_locked_fields: bool
    allow_extra_context: bool
    fields: list[ResolvedPreCallField] = field(default_factory=list)
    defaults: dict[str, Any] = field(default_factory=dict)


def parse_pre_call_form_settings(
    settings: dict[str, Any] | None,
) -> PreCallFormSettings | None:
    if not settings:
        return None
    raw = settings.get("preCallForm")
    if raw is None:
        raw = settings.get("pre_call_form")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("preCallForm must be an object")
    return PreCallFormSettings.model_validate(raw)


def normalize_embed_settings(
    settings: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if settings is None:
        return None
    pre_call_form = parse_pre_call_form_settings(settings)
    normalized = dict(settings)
    if pre_call_form is not None:
        normalized["preCallForm"] = pre_call_form.model_dump(
            by_alias=True, exclude_none=True
        )
    return normalized


def resolve_published_definition(workflow: Any) -> Any | None:
    definition = getattr(workflow, "released_definition", None)
    if definition is not None:
        return definition
    return getattr(workflow, "current_definition", None)


def resolve_template_defaults(workflow: Any, definition: Any | None) -> dict[str, Any]:
    if definition is not None:
        return dict(definition.template_context_variables or {})
    return dict(getattr(workflow, "template_context_variables", None) or {})


def extract_referenced_variables(definition: Any | None) -> set[str]:
    if definition is None or not definition.workflow_json:
        return set()
    try:
        graph = WorkflowGraph(ReactFlowDTO.model_validate(definition.workflow_json))
        return graph.get_required_template_variables()
    except Exception as exc:
        logger.warning(f"Could not scan workflow template variables: {exc}")
        return set()


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (dict, list)):
        return bool(value)
    return True


def _is_scalar(value: Any) -> bool:
    return isinstance(value, (str, int, float, bool))


def _humanize(name: str) -> str:
    return name.replace("_", " ").strip().title() or name


def _infer_type(value: Any) -> str:
    if isinstance(value, bool):
        return "checkbox"
    if isinstance(value, (int, float)):
        return "number"
    return "text"


def _build_field(
    name: str,
    defaults: dict[str, Any],
    configured: dict[str, Any],
) -> ResolvedPreCallField:
    cfg = configured.get(name)
    value = defaults.get(name)
    has_value = _has_value(value)
    editable = (
        False
        if has_value
        else (cfg.editable if cfg and cfg.editable is not None else True)
    )
    field_type = cfg.type if cfg and cfg.type else _infer_type(value)
    if field_type not in PRE_CALL_FIELD_TYPES:
        field_type = "text"
    required = cfg.required if cfg and cfg.required is not None else editable
    max_length = None
    if editable:
        max_length = (
            cfg.max_length
            if cfg and cfg.max_length is not None
            else (4000 if field_type == "textarea" else 500)
        )
    options = cfg.options if cfg and cfg.options else None
    if field_type == "select" and not options:
        field_type = "text"
    return ResolvedPreCallField(
        name=name,
        label=(cfg.label if cfg and cfg.label else _humanize(name)),
        type=field_type,
        required=required,
        editable=editable,
        has_value=has_value,
        value=value,
        placeholder=cfg.placeholder if cfg else None,
        max_length=max_length,
        options=options,
        order=cfg.order if cfg else 0,
    )


def build_pre_call_form(
    workflow: Any,
    definition: Any | None,
    settings: PreCallFormSettings | None,
) -> ResolvedPreCallForm | None:
    if definition is None:
        return None

    defaults = resolve_template_defaults(workflow, definition)
    configured = settings.fields if settings else {}
    referenced = extract_referenced_variables(definition)

    ordered_names: list[str] = []
    for name, _cfg in sorted(
        configured.items(), key=lambda item: (item[1].order, item[0])
    ):
        if not PRE_CALL_VARIABLE_NAME_PATTERN.match(name):
            logger.warning(f"Skipping invalid pre-call field name: {name!r}")
            continue
        if name not in ordered_names:
            ordered_names.append(name)
    for name in defaults:
        if not PRE_CALL_VARIABLE_NAME_PATTERN.match(name):
            logger.warning(f"Skipping invalid template variable name: {name!r}")
            continue
        if name not in ordered_names:
            ordered_names.append(name)
    for name in sorted(referenced):
        if not PRE_CALL_VARIABLE_NAME_PATTERN.match(name):
            logger.warning(f"Skipping invalid template variable name: {name!r}")
            continue
        if name not in ordered_names:
            ordered_names.append(name)

    fields = [_build_field(name, defaults, configured) for name in ordered_names]
    has_fields = bool(fields)

    return ResolvedPreCallForm(
        enabled=(
            settings.enabled
            if settings and settings.enabled is not None
            else has_fields
        ),
        title=(settings.title if settings and settings.title else "Before we start"),
        description=settings.description if settings else None,
        submit_label=(
            settings.submit_label
            if settings and settings.submit_label
            else "Start call"
        ),
        always_show=(
            settings.always_show
            if settings and settings.always_show is not None
            else has_fields
        ),
        show_locked_fields=(
            settings.show_locked_fields
            if settings and settings.show_locked_fields is not None
            else True
        ),
        allow_extra_context=bool(settings.allow_extra_context) if settings else False,
        fields=fields,
        defaults=defaults,
    )


def public_pre_call_form(form: ResolvedPreCallForm | None) -> PublicPreCallForm | None:
    if form is None:
        return None
    return PublicPreCallForm(
        enabled=form.enabled,
        title=form.title,
        description=form.description,
        submit_label=form.submit_label,
        always_show=form.always_show,
        show_locked_fields=form.show_locked_fields,
        allow_extra_context=form.allow_extra_context,
        fields=[
            PublicPreCallFormField(
                name=item.name,
                label=item.label,
                type=item.type,
                required=item.required,
                editable=item.editable,
                has_value=item.has_value,
                placeholder=item.placeholder,
                value=item.value if item.editable and _is_scalar(item.value) else None,
                max_length=item.max_length,
                options=item.options,
            )
            for item in form.fields
        ],
    )


def validate_pre_call_form_settings(
    settings: PreCallFormSettings | None,
    form: ResolvedPreCallForm | None = None,
) -> None:
    if settings is None:
        return
    resolved_by_name = (
        {field.name: field for field in form.fields} if form is not None else {}
    )
    for name, cfg in settings.fields.items():
        resolved = resolved_by_name.get(name)
        if resolved is not None and not resolved.editable:
            continue
        if cfg.type == "select" and not cfg.options:
            raise ValueError(f"Pre-call select field '{name}' has no options")


def validate_pre_call_form_config(form: ResolvedPreCallForm | None) -> None:
    if form is None:
        return
    for item in form.fields:
        if item.required and not item.editable and not item.has_value:
            raise ValueError(
                f"Pre-call field '{item.name}' is required and locked but has no value"
            )
        if item.editable and item.type not in PRE_CALL_FIELD_TYPES:
            raise ValueError(f"Unsupported pre-call field type: {item.type}")
        if item.editable and item.type == "select" and not item.options:
            raise ValueError(f"Pre-call select field '{item.name}' has no options")


def _coerce_value(item: ResolvedPreCallField, raw: Any) -> tuple[Any, str | None]:
    if raw is None:
        return None, None

    if item.type in ("text", "textarea"):
        if not isinstance(raw, str):
            return None, "Must be text."
        value = raw.strip()
        if not value:
            return None, None
        if item.max_length and len(value) > item.max_length:
            return None, f"Must be at most {item.max_length} characters."
        return value, None

    if item.type == "number":
        if isinstance(raw, bool):
            return None, "Must be a number."
        if isinstance(raw, (int, float)):
            return raw, None
        if not isinstance(raw, str):
            return None, "Must be a number."
        value = raw.strip()
        if not value:
            return None, None
        try:
            number = float(value) if any(c in value for c in ".eE") else int(value)
        except ValueError:
            return None, "Must be a number."
        if number != number or number in (float("inf"), float("-inf")):
            return None, "Must be a number."
        return number, None

    if item.type == "checkbox":
        if isinstance(raw, bool):
            return raw, None
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            if lowered in ("true", "1", "on", "yes"):
                return True, None
            if lowered in ("false", "0", "off", "no", ""):
                return False, None
        return None, "Must be true or false."

    if item.type == "select":
        if not isinstance(raw, str):
            return None, "Must be a valid option."
        value = raw.strip()
        if not value:
            return None, None
        if item.options and value not in item.options:
            return None, "Must be a valid option."
        if item.max_length and len(value) > item.max_length:
            return None, f"Must be at most {item.max_length} characters."
        return value, None

    if not isinstance(raw, str):
        return None, "Must be text."
    return raw.strip() or None, None


def validate_and_merge_context(
    form: ResolvedPreCallForm, submitted: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, str]]:
    submitted = submitted or {}
    errors: dict[str, str] = {}
    merged = dict(form.defaults)
    known = {item.name for item in form.fields}

    for item in form.fields:
        if item.name in submitted:
            raw = submitted[item.name]
            if not item.editable:
                if not _values_equal(item.value, raw):
                    errors[item.name] = (
                        "This value is provided by the site and cannot be changed."
                    )
                continue

            value, error = _coerce_value(item, raw)
            if error:
                errors[item.name] = error
                continue
            if value is None or (isinstance(value, str) and not value):
                if item.required:
                    errors[item.name] = "This field is required."
                else:
                    merged.pop(item.name, None)
                continue
            if item.type == "checkbox" and item.required and value is False:
                errors[item.name] = "This field is required."
                continue
            merged[item.name] = value
        elif item.required:
            if not item.has_value:
                errors[item.name] = "This field is required."

    extra = {name: value for name, value in submitted.items() if name not in known}
    if extra:
        if form.allow_extra_context:
            merged.update(extra)
        else:
            for name in extra:
                errors[name] = "Unknown field."

    return merged, errors


def _values_equal(left: Any, right: Any) -> bool:
    if left == right:
        return True
    if isinstance(left, (str, int, float, bool)) and isinstance(
        right, (str, int, float, bool)
    ):
        return str(left) == str(right)
    return False


def has_unpublished_variable_changes(
    workflow: Any, draft: Any | None, definition: Any | None
) -> bool:
    if draft is None:
        return False
    published = resolve_template_defaults(workflow, definition)
    draft_vars = dict(getattr(draft, "template_context_variables", None) or {})
    return draft_vars != published

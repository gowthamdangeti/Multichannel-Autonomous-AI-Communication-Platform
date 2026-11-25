"""Schemas for embed pre-call forms."""

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

PRE_CALL_FIELD_TYPES = {"text", "textarea", "number", "select", "checkbox"}
PRE_CALL_VARIABLE_NAME_PATTERN = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]*\Z")


class PreCallFormFieldSettings(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )

    label: str | None = Field(default=None, max_length=120)
    type: str | None = None
    required: bool | None = None
    editable: bool | None = None
    placeholder: str | None = Field(default=None, max_length=200)
    order: int = 0
    max_length: int | None = Field(default=None, ge=1, le=4000)
    options: list[str] | None = Field(default=None, max_length=100)

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str | None) -> str | None:
        if value is not None and value not in PRE_CALL_FIELD_TYPES:
            raise ValueError(f"type must be one of {sorted(PRE_CALL_FIELD_TYPES)}")
        return value


class PreCallFormSettings(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )

    enabled: bool | None = None
    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    submit_label: str | None = Field(default=None, max_length=40)
    always_show: bool | None = None
    show_locked_fields: bool | None = None
    allow_extra_context: bool = False
    fields: dict[str, PreCallFormFieldSettings] = Field(default_factory=dict)

    @field_validator("fields")
    @classmethod
    def validate_field_names(
        cls, value: dict[str, PreCallFormFieldSettings]
    ) -> dict[str, PreCallFormFieldSettings]:
        invalid = [
            name for name in value if not PRE_CALL_VARIABLE_NAME_PATTERN.match(name)
        ]
        if invalid:
            raise ValueError(f"Invalid pre-call field names: {', '.join(invalid)}")
        return value


class PublicPreCallFormField(BaseModel):
    name: str
    label: str
    type: Literal["text", "textarea", "number", "select", "checkbox"]
    required: bool
    editable: bool
    has_value: bool
    placeholder: str | None = None
    value: Any | None = None
    max_length: int | None = None
    options: list[str] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not PRE_CALL_VARIABLE_NAME_PATTERN.match(value):
            raise ValueError("Invalid pre-call field name")
        return value


class PublicPreCallForm(BaseModel):
    enabled: bool
    title: str
    description: str | None = None
    submit_label: str
    always_show: bool
    show_locked_fields: bool
    allow_extra_context: bool
    fields: list[PublicPreCallFormField]

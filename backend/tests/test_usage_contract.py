from api.services.workflow.usage_contract import NormalizedUsage, normalize_usage


def test_normalize_usage_uses_input_output_when_total_is_missing():
    usage = normalize_usage(
        {
            "prompt_tokens": 12,
            "completion_tokens": 5,
            "cache_read_input_tokens": 3,
        }
    )

    assert usage == NormalizedUsage(
        input_tokens=12,
        output_tokens=5,
        total_tokens=17,
        cache_read_tokens=3,
    )


def test_normalize_usage_rejects_negative_and_non_finite_values():
    usage = normalize_usage(
        {
            "prompt_tokens": -1,
            "completion_tokens": "bad",
            "total_tokens": float("inf"),
            "input_units": float("nan"),
        }
    )

    assert usage == NormalizedUsage()


def test_normalize_usage_preserves_cache_fields_and_uses_declared_total_floor():
    usage = normalize_usage(
        {
            "prompt_tokens": 12,
            "completion_tokens": 5,
            "total_tokens": 99,
            "cache_read_input_tokens": 3,
            "cache_creation_input_tokens": 2,
        }
    )

    assert usage.input_tokens == 12
    assert usage.output_tokens == 5
    assert usage.total_tokens == 99
    assert usage.cache_read_tokens == 3
    assert usage.cache_write_tokens == 2


def test_cached_prompt_tokens_reads_every_provider_shape():
    from types import SimpleNamespace

    from api.services.workflow.usage_contract import cached_prompt_tokens

    # OpenAI-compatible (OpenAI / DeepSeek / Azure): prompt_tokens_details.cached_tokens
    openai_style = SimpleNamespace(
        prompt_tokens=7590, prompt_tokens_details=SimpleNamespace(cached_tokens=6400)
    )
    assert cached_prompt_tokens(openai_style) == 6400
    # DeepSeek native field
    assert cached_prompt_tokens(SimpleNamespace(prompt_cache_hit_tokens=512)) == 512
    # Anthropic-style field, and plain dicts
    assert cached_prompt_tokens({"cache_read_input_tokens": 128}) == 128
    # Missing / null details -> 0, never an error
    assert cached_prompt_tokens(SimpleNamespace(prompt_tokens_details=None)) == 0
    assert cached_prompt_tokens(None) == 0

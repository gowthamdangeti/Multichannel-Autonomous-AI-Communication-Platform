"""One-shot LLM calls survive models that only accept their default temperature."""

import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import httpx  # noqa: E402
import pytest  # noqa: E402
from openai import BadRequestError  # noqa: E402

from api.services.gen_ai.temperature import create_chat_completion, model_fixes_temperature  # noqa: E402


def _client(side_effect):
    client = MagicMock()
    client.chat.completions.create = AsyncMock(side_effect=side_effect)
    return client


def _bad_request(param, message):
    response = httpx.Response(400, request=httpx.Request("POST", "http://x"))
    return BadRequestError(message, response=response, body={"error": {"message": message, "param": param}})


def test_known_fixed_temperature_models():
    assert model_fixes_temperature("azure/gpt-6-luna")
    assert model_fixes_temperature("o3-mini") and model_fixes_temperature("gpt-5")
    assert not model_fixes_temperature("gpt-4.1") and not model_fixes_temperature(None)


@pytest.mark.asyncio
async def test_temperature_is_left_out_up_front_for_a_fixed_model():
    client = _client(["ok"])
    assert await create_chat_completion(client, model="azure/gpt-6-luna", messages=[], temperature=0) == "ok"
    assert "temperature" not in client.chat.completions.create.await_args.kwargs
    assert client.chat.completions.create.await_count == 1


@pytest.mark.asyncio
async def test_unknown_model_that_rejects_temperature_is_retried_without_it():
    err = _bad_request("temperature", "Unsupported value: 'temperature' does not support 0 with this model.")
    client = _client([err, "ok"])
    assert await create_chat_completion(client, model="some-proxy-model", messages=[], temperature=0) == "ok"
    first, second = client.chat.completions.create.await_args_list
    assert first.kwargs["temperature"] == 0 and "temperature" not in second.kwargs


@pytest.mark.asyncio
async def test_other_bad_requests_still_raise():
    client = _client([_bad_request("messages", "messages is required")])
    with pytest.raises(BadRequestError):
        await create_chat_completion(client, model="gpt-4.1", messages=[], temperature=0.2)

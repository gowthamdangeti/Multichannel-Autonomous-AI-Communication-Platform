import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from types import SimpleNamespace
from api.services.whatsapp.conversation import (
    _generate_reply,
    _synthesize_voice_reply,
    handle_inbound,
)
from api.db.models import WhatsAppNumberModel

async def run_5_tests():
    print("==================== RUNNING TESTS 1 to 5 ====================")

    # TEST 1: Language from Models & Keys (TTS Language = te)
    agent_1 = SimpleNamespace(
        id=11, organization_id=1, name="Voice reply test",
        system_prompt="Helpful bot", guardrails="",
        greeting="", model_config_ref={}, documents=[], tools=[],
        active_contacts=[], deactive_contacts=[], is_active=True
    )
    with patch("api.services.whatsapp.conversation.get_effective_ai_model_configuration_for_workflow") as mock_cfg, \
         patch("api.services.whatsapp.conversation.AsyncOpenAI") as mock_openai, \
         patch("api.services.audio_providers.registry.get_tts_provider") as mock_get_provider:
        mock_llm = SimpleNamespace(provider="google", api_key=["k"], model="gemini-3.5-flash", base_url=None)
        mock_tts = SimpleNamespace(provider="soniox", api_key=["k"], model="tts-rt-v2", voice="Maya", language="te")
        mock_cfg.return_value = SimpleNamespace(llm=mock_llm, embeddings=None, tts=mock_tts)

        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.choices = [SimpleNamespace(message=SimpleNamespace(content="నమస్కారం", tool_calls=[]))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)
        mock_openai.return_value = mock_client

        reply = await _generate_reply(agent_1, [], "Hello, how are you?")
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        sys_msg = next(m["content"] for m in call_kwargs["messages"] if m["role"] == "system")
        assert "IMPORTANT: You must respond ONLY in Telugu (te)" in sys_msg

        mock_provider = MagicMock()
        mock_provider.synthesize = AsyncMock(return_value=b"OPUS_AUDIO")
        mock_get_provider.return_value = mock_provider

        await _synthesize_voice_reply(reply, agent_1)
        req = mock_provider.synthesize.call_args[0][0]
        assert req.language == "te", f"Expected te, got {req.language}"
        assert req.voice == "Maya", f"Expected Maya, got {req.voice}"
        print("TEST 1 PASSED: Models & Keys TTS Language=te -> LLM prompted Telugu, TTS language=te")

    # TEST 2: Change platform language, agent follows (TTS Language = hi)
    with patch("api.services.whatsapp.conversation.get_effective_ai_model_configuration_for_workflow") as mock_cfg, \
         patch("api.services.whatsapp.conversation.AsyncOpenAI") as mock_openai, \
         patch("api.services.audio_providers.registry.get_tts_provider") as mock_get_provider:
        mock_llm = SimpleNamespace(provider="google", api_key=["k"], model="gemini-3.5-flash", base_url=None)
        mock_tts = SimpleNamespace(provider="soniox", api_key=["k"], model="tts-rt-v2", voice="Maya", language="hi")
        mock_cfg.return_value = SimpleNamespace(llm=mock_llm, embeddings=None, tts=mock_tts)

        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.choices = [SimpleNamespace(message=SimpleNamespace(content="नमस्ते", tool_calls=[]))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)
        mock_openai.return_value = mock_client

        reply = await _generate_reply(agent_1, [], "Hello, how are you?")
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        sys_msg = next(m["content"] for m in call_kwargs["messages"] if m["role"] == "system")
        assert "IMPORTANT: You must respond ONLY in Hindi (hi)" in sys_msg

        mock_provider = MagicMock()
        mock_provider.synthesize = AsyncMock(return_value=b"OPUS_AUDIO")
        mock_get_provider.return_value = mock_provider

        await _synthesize_voice_reply(reply, agent_1)
        req = mock_provider.synthesize.call_args[0][0]
        assert req.language == "hi", f"Expected hi, got {req.language}"
        print("TEST 2 PASSED: Models & Keys TTS Language=hi -> Agent followed with Hindi (hi)")

    # TEST 3: Voice from Models & Keys (Voice = Adrian)
    with patch("api.services.whatsapp.conversation.get_effective_ai_model_configuration_for_workflow") as mock_cfg, \
         patch("api.services.audio_providers.registry.get_tts_provider") as mock_get_provider:
        mock_tts = SimpleNamespace(provider="soniox", api_key=["key1"], model="tts-rt-v2", voice="Adrian", language="en")
        mock_cfg.return_value = SimpleNamespace(tts=mock_tts)
        mock_provider = MagicMock()
        mock_provider.synthesize = AsyncMock(return_value=b"OPUS_AUDIO")
        mock_get_provider.return_value = mock_provider

        await _synthesize_voice_reply("Hello there", agent_1)
        req = mock_provider.synthesize.call_args[0][0]
        assert req.voice == "Adrian", f"Expected Adrian, got {req.voice}"
        assert req.language == "en", f"Expected en, got {req.language}"
        print("TEST 3 PASSED: Models & Keys Voice=Adrian -> TTS request voice=Adrian")

    # TEST 4: Greeting & New contact handling
    agent_3 = SimpleNamespace(
        id=11, organization_id=1, name="Greeting agent",
        system_prompt="Bot", guardrails="",
        greeting="Hi, I'm Aria. Welcome!",
        model_config_ref={}, documents=[], tools=[],
        active_contacts=[], deactive_contacts=[], is_active=True
    )
    mock_num = WhatsAppNumberModel(id=1, organization_id=1, name="test_num", openwa_session_name="sess_1", assigned_agent_id=11)
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation.db_client.get_conversation") as mock_get_convo, \
         patch("api.services.whatsapp.conversation.db_client.append_messages") as mock_append, \
         patch("api.services.whatsapp.conversation.get_effective_ai_model_configuration_for_workflow") as mock_get_eff, \
         patch("api.services.whatsapp.conversation.get_openwa_client") as mock_openwa:
        mock_get_eff.return_value = None
        
        mock_s = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = agent_3
        mock_s.execute = AsyncMock(return_value=mock_result)
        mock_db_sess.return_value.__aenter__.return_value = mock_s

        mock_get_convo.return_value = None
        mock_client = MagicMock()
        mock_client.send_text = AsyncMock()
        mock_openwa.return_value = mock_client

        await handle_inbound(mock_num, "919999999999", "Hello")
        sent_text = mock_client.send_text.call_args[0][2]
        assert sent_text == "Hi, I'm Aria. Welcome!", f"Got {sent_text}"
        print("TEST 4 PASSED: First message from new contact received exact agent greeting")

    # TEST 5: Tools & KB Isolation
    tool_allowed = SimpleNamespace(
        id=101, tool_uuid="tool-uuid-101", name="weather_lookup", description="Lookup weather", definition={"config": {"parameters": []}},
        category=SimpleNamespace(value="http_api")
    )
    doc_1 = SimpleNamespace(document_uuid="doc-uuid-111", filename="agent_guide.pdf")
    agent_5 = SimpleNamespace(
        id=11, organization_id=1, name="Tool & Doc agent",
        system_prompt="Bot", guardrails="", greeting="",
        model_config_ref={}, documents=[doc_1], tools=[tool_allowed],
        active_contacts=[], deactive_contacts=[], is_active=True
    )
    with patch("api.services.whatsapp.conversation.get_effective_ai_model_configuration_for_workflow") as mock_cfg, \
         patch("api.services.whatsapp.conversation.retrieve_from_knowledge_base") as mock_rag, \
         patch("api.services.whatsapp.conversation.AsyncOpenAI") as mock_openai:
        mock_llm = SimpleNamespace(provider="google", api_key=["k"], model="gemini-3.5-flash", base_url=None)
        mock_emb = SimpleNamespace(provider="google", api_key=["k"], model="text-embedding-004", base_url=None, endpoint=None, api_version=None)
        mock_cfg.return_value = SimpleNamespace(llm=mock_llm, embeddings=mock_emb, tts=None)
        mock_rag.return_value = {"chunks": [{"filename": "agent_guide.pdf", "text": "Agent guide content"}]}
        
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.choices = [SimpleNamespace(message=SimpleNamespace(content="Based on guide...", tool_calls=[]))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)
        mock_openai.return_value = mock_client

        await _generate_reply(agent_5, [], "Tell me about the guide")
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        tools_sent = [t["function"]["name"] for t in call_kwargs.get("tools", [])]
        assert tools_sent == ["weather_lookup"], f"Unexpected tools: {tools_sent}"
        rag_call_kwargs = mock_rag.call_args.kwargs
        assert rag_call_kwargs["document_uuids"] == ["doc-uuid-111"]
        print("TEST 5 PASSED: Tools and KB strictly isolated to agent configuration")

    print("==================== ALL 5 TESTS PASSED ====================")

if __name__ == "__main__":
    asyncio.run(run_5_tests())

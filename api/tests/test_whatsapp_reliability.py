import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from api.routes.whatsapp import (
    WHATSAPP_DEDUPE_TTL_SECONDS,
    _claim_inbound_message,
    _inbound_tasks,
    _release_inbound_message,
    router as whatsapp_router,
)
from api.services.whatsapp.conversation import handle_inbound, handle_inbound_media


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(whatsapp_router)
    return app


@pytest.mark.asyncio
async def test_claim_and_release_inbound_message_lifecycle():
    """Verify deduplication lock claiming, TTL, and manual release after failure."""
    mock_redis = AsyncMock()
    # 1. First claim succeeds
    mock_redis.set.return_value = True

    with patch("api.routes.whatsapp._whatsapp_dedupe_redis", mock_redis):
        # Empty message_id does not lock
        claimed_empty = await _claim_inbound_message("sess_1", None)
        assert claimed_empty is True
        assert mock_redis.set.call_count == 0

        # Valid message_id sets key with NX and TTL
        claimed_first = await _claim_inbound_message("sess_1", "msg_123")
        assert claimed_first is True
        mock_redis.set.assert_called_once_with(
            "whatsapp:inbound:sess_1:msg_123",
            "1",
            nx=True,
            ex=WHATSAPP_DEDUPE_TTL_SECONDS,
        )
        assert WHATSAPP_DEDUPE_TTL_SECONDS == 86400

        # Duplicate delivery returns False
        mock_redis.set.return_value = False
        claimed_duplicate = await _claim_inbound_message("sess_1", "msg_123")
        assert claimed_duplicate is False

        # Release deletes the key
        await _release_inbound_message("sess_1", "msg_123")
        mock_redis.delete.assert_called_once_with("whatsapp:inbound:sess_1:msg_123")

        # Release with empty message_id is a no-op
        mock_redis.delete.reset_mock()
        await _release_inbound_message("sess_1", None)
        mock_redis.delete.assert_not_called()


@pytest.mark.asyncio
async def test_background_task_lifecycle_and_cleanup():
    """Verify background tasks are added to _inbound_tasks and cleaned up when done."""
    app = _make_test_app()
    mock_number = SimpleNamespace(
        id=1,
        organization_id=10,
        name="Support",
        openwa_session_name="sess_live",
        assigned_agent_id=5,
    )

    started_event = asyncio.Event()
    finish_event = asyncio.Event()

    async def fake_handle_inbound(*args, **kwargs):
        started_event.set()
        await finish_event.wait()
        return True

    payload = {
        "event": "message.received",
        "data": {
            "id": "msg_lifecycle_001",
            "from": "1234567890@c.us",
            "body": "Hello lifecycle",
        },
    }

    with patch("api.routes.whatsapp.db_client.get_whatsapp_number_by_session", new_callable=AsyncMock) as mock_get_num, \
         patch("api.routes.whatsapp._claim_inbound_message", new_callable=AsyncMock) as mock_claim, \
         patch("api.routes.whatsapp.handle_inbound", side_effect=fake_handle_inbound):
        
        mock_get_num.return_value = mock_number
        mock_claim.return_value = True

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/whatsapp/webhook/sess_live", json=payload)
            assert resp.status_code == 200
            assert resp.json() == {"ok": True}

            # Wait for background task to start
            await asyncio.wait_for(started_event.wait(), timeout=2.0)
            
            # Verify task is currently retained in _inbound_tasks
            assert len(_inbound_tasks) >= 1
            running_tasks = [t for t in _inbound_tasks if not t.done()]
            assert len(running_tasks) >= 1

            # Let task finish
            finish_event.set()
            await asyncio.gather(*running_tasks)
            # Give callback a moment to run
            await asyncio.sleep(0.05)

            # Verify task has been discarded from _inbound_tasks
            for t in running_tasks:
                assert t not in _inbound_tasks


@pytest.mark.asyncio
async def test_redis_dedupe_lock_released_on_handler_failure():
    """Verify Redis lock is released if _process_inbound encounters an error or returns False."""
    app = _make_test_app()
    mock_number = SimpleNamespace(
        id=1,
        organization_id=10,
        name="Support",
        openwa_session_name="sess_fail",
        assigned_agent_id=5,
    )

    payload = {
        "event": "message.received",
        "data": {
            "id": "msg_fail_001",
            "from": "1234567890@c.us",
            "body": "Fail me",
        },
    }

    # Case A: handler returns False
    with patch("api.routes.whatsapp.db_client.get_whatsapp_number_by_session", new_callable=AsyncMock) as mock_get_num, \
         patch("api.routes.whatsapp._claim_inbound_message", new_callable=AsyncMock) as mock_claim, \
         patch("api.routes.whatsapp._release_inbound_message", new_callable=AsyncMock) as mock_release, \
         patch("api.routes.whatsapp.handle_inbound", new_callable=AsyncMock) as mock_handle:
        
        mock_get_num.return_value = mock_number
        mock_claim.return_value = True
        mock_handle.return_value = False

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/whatsapp/webhook/sess_fail", json=payload)
            assert resp.status_code == 200

            # Await all background tasks
            if _inbound_tasks:
                await asyncio.gather(*list(_inbound_tasks))

            mock_release.assert_awaited_once_with("sess_fail", "msg_fail_001")

    # Case B: handler raises an exception
    with patch("api.routes.whatsapp.db_client.get_whatsapp_number_by_session", new_callable=AsyncMock) as mock_get_num, \
         patch("api.routes.whatsapp._claim_inbound_message", new_callable=AsyncMock) as mock_claim, \
         patch("api.routes.whatsapp._release_inbound_message", new_callable=AsyncMock) as mock_release, \
         patch("api.routes.whatsapp.handle_inbound", new_callable=AsyncMock) as mock_handle:
        
        mock_get_num.return_value = mock_number
        mock_claim.return_value = True
        mock_handle.side_effect = RuntimeError("Crash during inference")

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/whatsapp/webhook/sess_fail", json=payload)
            assert resp.status_code == 200

            if _inbound_tasks:
                await asyncio.gather(*list(_inbound_tasks), return_exceptions=True)

            mock_release.assert_awaited_once_with("sess_fail", "msg_fail_001")


@pytest.mark.asyncio
async def test_duplicate_webhook_ignored_without_spawning_task():
    """Verify duplicate webhooks are acknowledged immediately without reprocessing."""
    app = _make_test_app()
    mock_number = SimpleNamespace(
        id=1,
        organization_id=10,
        name="Support",
        openwa_session_name="sess_dup",
        assigned_agent_id=5,
    )

    payload = {
        "event": "message.received",
        "data": {
            "id": "msg_dup_999",
            "from": "1234567890@c.us",
            "body": "Duplicate test",
        },
    }

    initial_task_count = len(_inbound_tasks)

    with patch("api.routes.whatsapp.db_client.get_whatsapp_number_by_session", new_callable=AsyncMock) as mock_get_num, \
         patch("api.routes.whatsapp._claim_inbound_message", new_callable=AsyncMock) as mock_claim, \
         patch("api.routes.whatsapp.handle_inbound", new_callable=AsyncMock) as mock_handle:
        
        mock_get_num.return_value = mock_number
        mock_claim.return_value = False  # Duplicate claim rejected

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/whatsapp/webhook/sess_dup", json=payload)
            assert resp.status_code == 200
            assert resp.json() == {"ok": True}

            mock_handle.assert_not_called()
            assert len(_inbound_tasks) == initial_task_count


@pytest.mark.asyncio
async def test_successful_whatsapp_text_response():
    """Verify successful inbound text generates reply, appends to DB, and sends via OpenWA."""
    mock_number = SimpleNamespace(
        id=3,
        organization_id=20,
        name="Sales Desk",
        openwa_session_name="sess_sales",
        openwa_session_id="sess_id_sales",
        assigned_agent_id=7,
    )

    mock_agent = SimpleNamespace(
        id=7,
        organization_id=20,
        name="Sales Assistant",
        system_prompt="Helpful sales agent",
        greeting=None,
        is_active=True,
        active_contacts=[],
        deactive_contacts=[],
        tools=[],
        documents=[],
        model_config_ref={},
    )

    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation.db_client.get_conversation", new_callable=AsyncMock) as mock_get_convo, \
         patch("api.services.whatsapp.conversation.db_client.append_messages", new_callable=AsyncMock) as mock_append, \
         patch("api.services.whatsapp.conversation._generate_reply", new_callable=AsyncMock) as mock_gen_reply, \
         patch("api.services.whatsapp.conversation.get_openwa_client") as mock_openwa_getter:
        
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = mock_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        mock_get_convo.return_value = None
        mock_gen_reply.return_value = "Hello! We offer premium subscriptions."

        mock_openwa_client = MagicMock()
        mock_openwa_client.send_text = AsyncMock(return_value={"status": "sent"})
        mock_openwa_getter.return_value = mock_openwa_client

        success = await handle_inbound(mock_number, "15551234567", "Tell me about your plans")
        assert success is True

        # Verify DB append
        mock_append.assert_awaited_once_with(
            20,
            3,
            "15551234567",
            [
                {"role": "user", "content": "Tell me about your plans"},
                {"role": "assistant", "content": "Hello! We offer premium subscriptions."},
            ],
        )

        # Verify outbound delivery
        mock_openwa_client.send_text.assert_awaited_once_with(
            "sess_id_sales",
            "15551234567",
            "Hello! We offer premium subscriptions.",
        )


@pytest.mark.asyncio
async def test_llm_timeout_and_empty_responses():
    """Verify handle_inbound returns False when LLM times out or returns empty reply."""
    mock_number = SimpleNamespace(
        id=3,
        organization_id=20,
        name="Sales Desk",
        openwa_session_name="sess_sales",
        openwa_session_id="sess_id_sales",
        assigned_agent_id=7,
    )

    mock_agent = SimpleNamespace(
        id=7,
        organization_id=20,
        name="Sales Assistant",
        greeting=None,
        is_active=True,
        active_contacts=[],
        deactive_contacts=[],
        tools=[],
        documents=[],
        model_config_ref={},
    )

    # Subtest 1: LLM timeout / exception
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation.db_client.get_conversation", new_callable=AsyncMock) as mock_get_convo, \
         patch("api.services.whatsapp.conversation._generate_reply", new_callable=AsyncMock) as mock_gen_reply, \
         patch("api.services.whatsapp.conversation.get_openwa_client") as mock_openwa_getter:
        
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = mock_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session
        mock_get_convo.return_value = None

        mock_gen_reply.side_effect = TimeoutError("LLM response timed out after 30s")
        mock_openwa_client = MagicMock()
        mock_openwa_getter.return_value = mock_openwa_client

        with pytest.raises(TimeoutError):
            await handle_inbound(mock_number, "15551234567", "Hello")
        mock_openwa_client.send_text.assert_not_called()

    # Subtest 2: LLM returns empty text
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation.db_client.get_conversation", new_callable=AsyncMock) as mock_get_convo, \
         patch("api.services.whatsapp.conversation._generate_reply", new_callable=AsyncMock) as mock_gen_reply, \
         patch("api.services.whatsapp.conversation.get_openwa_client") as mock_openwa_getter:
        
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = mock_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session
        mock_get_convo.return_value = None

        mock_gen_reply.return_value = ""  # empty string
        mock_openwa_client = MagicMock()
        mock_openwa_getter.return_value = mock_openwa_client

        success = await handle_inbound(mock_number, "15551234567", "Hello")
        assert success is False
        mock_openwa_client.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_missing_or_inactive_agent_assignments():
    """Verify handle_inbound returns False for missing, non-existent, inactive agents, or blocked contacts."""
    # Case A: No assigned agent id
    number_no_agent = SimpleNamespace(
        id=1,
        organization_id=10,
        name="Unassigned Number",
        assigned_agent_id=None,
        openwa_session_name="sess_unassigned",
        openwa_session_id=None,
    )
    success = await handle_inbound(number_no_agent, "15550001", "Hello")
    assert success is False

    # Case B: Assigned agent id not in DB
    number_ghost_agent = SimpleNamespace(
        id=2,
        organization_id=10,
        name="Ghost Agent Number",
        assigned_agent_id=999,
        openwa_session_name="sess_ghost",
        openwa_session_id=None,
    )
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess:
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = None
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        success = await handle_inbound(number_ghost_agent, "15550001", "Hello")
        assert success is False

    # Case C: Agent inactive
    inactive_agent = SimpleNamespace(
        id=5,
        organization_id=10,
        name="Disabled Agent",
        is_active=False,
        tools=[],
        documents=[],
    )
    number_inactive = SimpleNamespace(
        id=3,
        organization_id=10,
        name="Inactive Number",
        assigned_agent_id=5,
        openwa_session_name="sess_inactive",
        openwa_session_id=None,
    )
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess:
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = inactive_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        success = await handle_inbound(number_inactive, "15550001", "Hello")
        assert success is False

    # Case D: Contact blocked by agent policy
    blocked_agent = SimpleNamespace(
        id=6,
        organization_id=10,
        name="Filtered Agent",
        is_active=True,
        tools=[],
        documents=[],
        active_contacts=["15559999"],  # only this number allowed
        deactive_contacts=[],
        model_config_ref={},
    )
    number_filtered = SimpleNamespace(
        id=4,
        organization_id=10,
        name="Filtered Number",
        assigned_agent_id=6,
        openwa_session_name="sess_filtered",
        openwa_session_id=None,
    )
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = blocked_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        # Contact 15550001 is not in active_contacts -> blocked
        success = await handle_inbound(number_filtered, "15550001", "Hello")
        assert success is False


@pytest.mark.asyncio
async def test_media_message_processing_scenarios():
    """Verify handle_inbound_media handles disabled media, invalid extensions, and valid media."""
    mock_number = SimpleNamespace(
        id=10,
        organization_id=1,
        name="Media Desk",
        openwa_session_name="sess_media",
        openwa_session_id="sess_id_media",
        assigned_agent_id=20,
    )

    base_agent = SimpleNamespace(
        id=20,
        organization_id=1,
        name="Media Agent",
        is_active=True,
        active_contacts=[],
        deactive_contacts=[],
        tools=[],
        documents=[],
        model_config_ref={},
        image_settings={"enabled": False},  # image disabled
        document_settings={"enabled": True, "allowed_extensions": [".pdf"], "max_files": 5, "max_file_size_mb": 10},
        audio_settings={"enabled": True, "allowed_extensions": [".ogg", ".mp3"], "max_files": 5, "max_file_size_mb": 10},
    )

    # Scenario 1: Disabled media type (image)
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation._persist_and_send_media_reply", new_callable=AsyncMock) as mock_send_reply, \
         patch("api.services.whatsapp.conversation.get_openwa_client"):
        
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = base_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        image_media = {"type": "image", "filename": "test.png", "mime_type": "image/png"}
        success = await handle_inbound_media(mock_number, "15550001", "Look at this", image_media, {})
        assert success is True
        mock_send_reply.assert_awaited_once()
        args = mock_send_reply.call_args[0]
        assert "Image processing is disabled for this agent" in args[3]

    # Scenario 2: Invalid extension for document (.exe instead of .pdf)
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation._persist_and_send_media_reply", new_callable=AsyncMock) as mock_send_reply, \
         patch("api.services.whatsapp.conversation.get_openwa_client"):
        
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = base_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        doc_media = {"type": "document", "filename": "malware.exe", "mime_type": "application/x-msdownload"}
        success = await handle_inbound_media(mock_number, "15550001", "Open this", doc_media, {})
        assert success is True
        mock_send_reply.assert_awaited_once()
        args = mock_send_reply.call_args[0]
        assert "file type is not enabled" in args[3].lower()

    # Scenario 3: Missing agent returns False
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess:
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = None
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        doc_media = {"type": "document", "filename": "doc.pdf", "mime_type": "application/pdf"}
        success = await handle_inbound_media(mock_number, "15550001", "Doc", doc_media, {})
        assert success is False

    # Scenario 4: Valid media download and processing
    valid_doc = {"type": "document", "filename": "statement.pdf", "mime_type": "application/pdf"}
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation._process_document", new_callable=AsyncMock) as mock_proc_doc, \
         patch("api.services.whatsapp.conversation._generate_reply", new_callable=AsyncMock) as mock_gen, \
         patch("api.services.whatsapp.conversation.db_client.get_conversation", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation.db_client.append_messages", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation.get_openwa_client") as mock_openwa_getter:
        
        mock_openwa_client = MagicMock()
        mock_openwa_client.download_media = AsyncMock(return_value={"data": "dGVzdCBwZGY=", "mimetype": "application/pdf"})
        mock_openwa_client.send_text = AsyncMock(return_value={"status": "sent"})
        mock_openwa_getter.return_value = mock_openwa_client

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = base_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        from api.services.whatsapp.conversation import MediaProcessingResult
        mock_proc_doc.return_value = MediaProcessingResult(success=True, user_context="Doc content")
        mock_gen.return_value = "Here is the summary of statement.pdf"

        success = await handle_inbound_media(mock_number, "15550001", "Check statement", valid_doc, {})
        assert success is True
        mock_openwa_client.send_text.assert_awaited_once()

    # Scenario 5: Media download fails unrecoverably with OpenWAError -> returns False
    with patch("api.services.whatsapp.conversation.db_client.async_session") as mock_db_sess, \
         patch("api.services.whatsapp.conversation._log_config_resolved", new_callable=AsyncMock), \
         patch("api.services.whatsapp.conversation.get_openwa_client") as mock_openwa_getter:
        from api.services.whatsapp.openwa_client import OpenWAError

        mock_openwa_client = MagicMock()
        mock_openwa_client.download_media = AsyncMock(side_effect=OpenWAError("Download timeout"))
        mock_openwa_getter.return_value = mock_openwa_client

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars().first.return_value = base_agent
        mock_session.execute.return_value = mock_result
        mock_db_sess.return_value.__aenter__.return_value = mock_session

        success = await handle_inbound_media(mock_number, "15550001", "Statement", valid_doc, {})
        assert success is False

"""WhatsApp channel — integration with the self-hosted OpenWA gateway.

The gateway (OpenWA, whatsapp-web.js engine) owns the actual WhatsApp Web
sessions; this package is the backend's typed client + domain glue for it:
one OpenWA *session* per connected phone number, inbound messages arriving via
webhook, outbound messages sent over REST.
"""

from api.services.whatsapp.openwa_client import (
    OpenWAClient,
    OpenWAError,
    get_openwa_client,
)

__all__ = ["OpenWAClient", "OpenWAError", "get_openwa_client"]

"""Domain errors for reading provider usage."""


class ProviderRequestNotFoundError(Exception):
    """No run in this organization holds this provider request."""

    def __init__(self, *, request_id: str):
        super().__init__(f"No call found for request {request_id}")
        self.request_id = request_id


class ProviderUsageAccessError(Exception):
    """The provider refused this key for good, so retrying can't help."""

    def __init__(self, *, provider: str, status_code: int):
        super().__init__(f"{provider} refused the usage request ({status_code})")
        self.provider = provider
        self.status_code = status_code

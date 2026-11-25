from types import SimpleNamespace

from api.services.whatsapp.conversation import _contact_allowed


def agent(active_contacts=None, deactive_contacts=None):
    return SimpleNamespace(
        active_contacts=active_contacts or [],
        deactive_contacts=deactive_contacts or [],
    )


def test_empty_active_contacts_allows_everyone():
    policy = agent(deactive_contacts=[])

    assert _contact_allowed(policy, "+919876543210") is True


def test_active_contacts_limit_replies_to_allowlisted_contacts():
    policy = agent(active_contacts=["+919876543210"])

    assert _contact_allowed(policy, "919876543210") is True
    assert _contact_allowed(policy, "+919811112222") is False


def test_deactive_contacts_block_when_active_list_is_empty():
    policy = agent(deactive_contacts=["+919876543210"])

    assert _contact_allowed(policy, "919876543210") is False
    assert _contact_allowed(policy, "+919811112222") is True


def test_deactive_contacts_override_active_contacts():
    policy = agent(
        active_contacts=["+919876543210"],
        deactive_contacts=["+919876543210"],
    )

    assert _contact_allowed(policy, "919876543210") is False


def test_contact_matching_accepts_country_code_variants():
    policy = agent(active_contacts=["9876543210"])

    assert _contact_allowed(policy, "+919876543210") is True

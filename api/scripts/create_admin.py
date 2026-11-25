"""Create (or promote) a super-admin user for self-hosted / local deployments.

Mirrors the email/password signup flow in api/routes/auth.py, but marks the user
as a superuser so they can reach the /admin panel (voices, model-configuration
presets, orgs, billing).

Usage (via the wrapper that loads the venv + api/.env):

    ./scripts/create_admin.sh --email admin@example.com --password 'secret' --name Admin

Or directly:

    python -m api.scripts.create_admin --email admin@example.com

If the password is omitted you'll be prompted for it. If a user with that email
already exists, it is promoted to superuser (its password is left unchanged).
"""

from __future__ import annotations

import argparse
import asyncio
import getpass

from sqlalchemy import update

from api.db import db_client
from api.db.models import UserModel
from api.utils.auth import hash_password


async def _mark_superuser(user_id: int) -> None:
    async with db_client.async_session() as session:
        await session.execute(
            update(UserModel).where(UserModel.id == user_id).values(is_superuser=True)
        )
        await session.commit()


async def create_admin(*, email: str, password: str, name: str | None) -> None:
    email = email.strip().lower()

    existing = await db_client.get_user_by_email(email)
    if existing is not None:
        await _mark_superuser(existing.id)
        print(
            f"User {email!r} already exists (id={existing.id}); "
            "promoted to superuser. Password left unchanged."
        )
        return

    user = await db_client.create_user_with_email(
        email=email,
        password_hash=hash_password(password),
        name=name,
    )

    # Give the admin a personal organization, same as the signup flow.
    org_provider_id = f"org_{user.provider_id}"
    organization, _ = await db_client.get_or_create_organization_by_provider_id(
        org_provider_id=org_provider_id, user_id=user.id
    )
    await db_client.add_user_to_organization(user.id, organization.id)
    await db_client.update_user_selected_organization(user.id, organization.id)

    await _mark_superuser(user.id)

    print(
        f"Created superuser {email!r} (id={user.id}, org_id={organization.id}).\n"
        "Log in with this email/password — the Admin panel (/admin) is now available."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or promote a super-admin user.")
    parser.add_argument("--email", required=True, help="Admin email address.")
    parser.add_argument(
        "--password",
        help="Admin password. If omitted, you will be prompted (input hidden).",
    )
    parser.add_argument("--name", default=None, help="Optional display name.")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Password: ")
    if not password:
        parser.error("a non-empty password is required")

    asyncio.run(create_admin(email=args.email, password=password, name=args.name))


if __name__ == "__main__":
    main()

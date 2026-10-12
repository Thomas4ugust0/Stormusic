"""tabelas iniciais: jobs e api_keys

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("api_key_id", sa.String(40), nullable=True),
        sa.Column("client_ip", sa.String(64), nullable=True),
        sa.Column("video_id", sa.String(11), nullable=False),
        sa.Column("source_url", sa.String(64), nullable=False),
        sa.Column("format", sa.String(10), nullable=False),
        sa.Column("quality", sa.String(10), nullable=False),
        sa.Column("remove_sponsors", sa.Boolean, nullable=False),
        sa.Column("cache_key", sa.String(64), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("progress", sa.Integer, nullable=False),
        sa.Column("video", sa.JSON, nullable=True),
        sa.Column("source_audio", sa.JSON, nullable=True),
        sa.Column("estimated_size_bytes", sa.Integer, nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("file_path", sa.Text, nullable=True),
        sa.Column("file_ext", sa.String(8), nullable=True),
        sa.Column("download_name", sa.String(160), nullable=True),
        sa.Column("warnings", sa.JSON, nullable=False),
        sa.Column("error_code", sa.String(40), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("error_retryable", sa.Boolean, nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("expires_at", TS, nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
    )
    for col in ("api_key_id", "video_id", "cache_key", "status", "expires_at"):
        op.create_index(f"ix_jobs_{col}", "jobs", [col])


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("api_keys")

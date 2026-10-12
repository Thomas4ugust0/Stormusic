from alembic import context

from app.core.config import get_settings
from app.core.db import Base, get_engine
from app.models import ApiKey, Job  # noqa: F401 - registra as tabelas

target_metadata = Base.metadata


def run() -> None:
    if context.is_offline_mode():
        context.configure(url=get_settings().database_url, target_metadata=target_metadata, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    with get_engine().connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run()

"""Gerenciamento de API keys: python -m app.cli create-key <nome> | revoke-key <id> | list-keys"""
import secrets
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.security import hash_api_key, new_api_key
from app.models import ApiKey


def main(argv: list[str]) -> int:
    s = get_settings()
    if len(argv) >= 2 and argv[0] == "create-key":
        if not s.api_key_pepper:
            print("Defina API_KEY_PEPPER antes de criar chaves.", file=sys.stderr)
            return 1
        key = new_api_key()
        kid = "key_" + secrets.token_hex(8)
        with session_scope() as db:
            db.add(ApiKey(id=kid, name=argv[1][:120], key_hash=hash_api_key(key, s.api_key_pepper)))
        print(f"id={kid}\napi_key={key}\n(guarde a chave: ela não será exibida novamente)")
        return 0
    if len(argv) == 2 and argv[0] == "revoke-key":
        with session_scope() as db:
            k = db.get(ApiKey, argv[1])
            if not k:
                print("não encontrada", file=sys.stderr)
                return 1
            k.revoked = True
        print("revogada")
        return 0
    if argv[:1] == ["list-keys"]:
        with session_scope() as db:
            for k in db.scalars(select(ApiKey)):
                print(k.id, k.name, "revogada" if k.revoked else "ativa", k.created_at.isoformat())
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

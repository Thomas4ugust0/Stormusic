import time
from pathlib import Path

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import health, routes
from app.core.config import get_settings
from app.core.errors import APIError
from app.core.logging import log, setup_logging
from app.core.security import new_request_id
from app.services.metrics import http_latency

STATIC = Path(__file__).parent / "static"
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "interest-cohort=(), geolocation=(), camera=(), microphone=()",
    # Sem CDN e sem terceiros: tudo é servido pela própria API.
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://i.ytimg.com; "
                               "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
                               "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}


def _err(status: int, code: str, message: str, rid: str | None, retryable: bool = False,
         headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, "retryable": retryable, "request_id": rid}},
                        status_code=status, headers=headers)


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)
    app = FastAPI(
        title=settings.app_name, version="1.0.0",
        description="Extração de áudio de vídeos públicos do YouTube, **sem anúncios**. "
                    "Use apenas com conteúdo que você tem o direito de baixar (veja docs/LEGAL.md).",
        docs_url=None, redoc_url=None,
    )
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "DELETE"],
                           allow_headers=["X-API-Key", "Authorization", "Content-Type", "Range"],
                           expose_headers=["Location", "Content-Range", "Content-Disposition", "Retry-After"])

    @app.middleware("http")
    async def context(request: Request, call_next):  # type: ignore[no-untyped-def]
        rid = new_request_id()
        request.state.request_id = rid
        structlog.contextvars.bind_contextvars(request_id=rid)
        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:  # noqa: BLE001
            log.exception("unhandled_error", path=request.url.path)
            response = _err(500, "internal_error", "Erro interno inesperado.", rid, True)
        route = request.scope.get("route")
        http_latency.labels(request.method, getattr(route, "path", "unmatched"), str(response.status_code)).observe(
            time.perf_counter() - start)
        response.headers["X-Request-ID"] = rid
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        log.info("http_request", method=request.method, route=getattr(route, "path", request.url.path),
                 status=response.status_code, ms=round((time.perf_counter() - start) * 1000, 1))
        structlog.contextvars.clear_contextvars()
        return response

    @app.exception_handler(APIError)
    async def api_error(request: Request, exc: APIError) -> JSONResponse:
        return _err(exc.status_code, exc.code, exc.message, getattr(request.state, "request_id", None),
                    exc.retryable, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        rid = getattr(request.state, "request_id", None)
        errs = exc.errors()
        if any(e.get("type") in ("json_invalid", "model_attributes_type") for e in errs) or any(
                e.get("loc") == ("body",) for e in errs):
            return _err(400, "bad_request", "JSON malformado ou corpo inválido.", rid)
        fields = ", ".join(".".join(str(x) for x in e.get("loc", [])[1:]) or "body" for e in errs)
        return _err(422, "validation_error", f"Campos inválidos: {fields}.", rid)

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {404: "not_found", 405: "method_not_allowed", 413: "file_too_large"}
        msg = {404: "Recurso não encontrado.", 405: "Método não permitido."}.get(exc.status_code, str(exc.detail))
        return _err(exc.status_code, codes.get(exc.status_code, "http_error"), msg,
                    getattr(request.state, "request_id", None))

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error")
        return _err(500, "internal_error", "Erro interno inesperado.", getattr(request.state, "request_id", None), True)

    app.include_router(health.router)
    app.include_router(routes.router)
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/docs", include_in_schema=False)
    def docs() -> HTMLResponse:
        return get_swagger_ui_html(openapi_url="/openapi.json", title=f"{settings.app_name} - Docs",
                                   swagger_js_url="/static/vendor/swagger-ui-bundle.js",
                                   swagger_css_url="/static/vendor/swagger-ui.css",
                                   swagger_favicon_url="/static/favicon.svg")

    @app.get("/redoc", include_in_schema=False)
    def redoc() -> HTMLResponse:
        return get_redoc_html(openapi_url="/openapi.json", title=f"{settings.app_name} - ReDoc",
                              redoc_js_url="/static/vendor/redoc.standalone.js",
                              redoc_favicon_url="/static/favicon.svg", with_google_fonts=False)

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    return app


app = create_app()

"""Contrato único de erros (seção 9)."""
from dataclasses import dataclass

# code -> (mensagem em português, retryable)
JOB_ERRORS: dict[str, tuple[str, bool]] = {
    "invalid_url": ("A URL informada é inválida ou não é de um vídeo do YouTube.", False),
    "unsupported_source": ("Esta fonte não é suportada (apenas vídeos individuais do YouTube).", False),
    "video_unavailable": ("O vídeo não está disponível ou foi removido.", False),
    "video_private": ("Este vídeo é privado e não pode ser processado.", False),
    "video_members_only": ("Este vídeo é exclusivo para membros ou pago e não pode ser processado.", False),
    "video_age_restricted": ("Este vídeo exige login ou confirmação de idade e não pode ser processado.", False),
    "video_geo_blocked": ("Este vídeo está bloqueado na região do servidor.", False),
    "video_drm_protected": ("Este vídeo é protegido por DRM e não pode ser processado.", False),
    "live_not_supported": ("Transmissões ao vivo em andamento ou agendadas não são suportadas.", False),
    "duration_exceeded": ("A duração do vídeo excede o limite permitido.", False),
    "file_too_large": ("O arquivo de áudio excede o tamanho máximo permitido.", False),
    "source_blocked": ("O YouTube bloqueou temporariamente as requisições deste servidor. Tente mais tarde.", True),
    "extractor_outdated": ("O extrator está desatualizado para esta mudança do YouTube. O operador precisa atualizá-lo.", True),
    "conversion_failed": ("Falha ao converter o áudio.", True),
    "timeout": ("A tarefa excedeu o tempo máximo de processamento.", True),
    "cancelled": ("A tarefa foi cancelada.", False),
    "internal_error": ("Erro interno inesperado.", True),
}


@dataclass
class JobError(Exception):
    """Falha de tarefa com código estável."""

    code: str
    detail: str | None = None

    def __post_init__(self) -> None:
        if self.code not in JOB_ERRORS:
            self.code = "internal_error"
        super().__init__(self.code)

    @property
    def message(self) -> str:
        return JOB_ERRORS[self.code][0]

    @property
    def retryable(self) -> bool:
        return JOB_ERRORS[self.code][1]


class TransientJobError(JobError):
    """Erro transitório: elegível a nova tentativa com backoff."""


@dataclass
class APIError(Exception):
    status_code: int
    code: str
    message: str
    retryable: bool = False
    headers: dict[str, str] | None = None

    def __post_init__(self) -> None:
        super().__init__(self.code)


JOB_ERROR_HTTP = {"invalid_url": 400, "unsupported_source": 400, "file_too_large": 413, "duration_exceeded": 413}

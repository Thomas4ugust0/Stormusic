# Decisões

1. **Processamento assíncrono (Celery + Redis).** Extrações levam de segundos a minutos; a API responde
   202 imediatamente e o cliente acompanha por polling. `acks_late` + `prefetch=1` evitam perda de tarefas.
2. **yt-dlp como única dependência de extração**, isolado atrás de `AudioSource`. Quando o YouTube muda,
   atualiza-se só a versão fixada; os testes usam uma fonte falsa e não dependem de rede.
3. **Sem anúncios por construção.** Baixamos o stream de áudio diretamente; anúncios de vídeo são servidos
   pelo player e não existem nesse stream. Patrocínios embutidos pelo criador são outra coisa: só são
   removidos com `remove_sponsors=true`, em melhor esforço, via SponsorBlock.
4. **`original` não recodifica.** Os demais formatos recodificam e nunca prometem mais qualidade que a
   fonte (o bitrate é limitado ao da origem, e isso é informado em `limitations`/`warnings`).
5. **Verificação de integridade:** a duração final é comparada com a esperada; divergência sem
   remoção de patrocínios resulta em falha em vez de arquivo truncado.
6. **Validação estrita de URL**: allowlist de hosts, extração do ID e reconstrução da URL canônica,
   impedindo SSRF e o uso de playlists/canais.
7. **API keys com HMAC-SHA256 + pepper**; a chave em texto puro nunca é armazenada. Tarefas são isoladas
   por chave (outra chave recebe 404, não 403, para não vazar existência).
8. **Rate limiting em camadas:** por IP, por chave, tarefas simultâneas por chave, tamanho da fila e
   limite global de extrações/hora para reduzir bloqueios do lado do YouTube.
9. **Documentação sem CDN em runtime:** assets do Swagger/ReDoc são baixados no build e servidos pela API,
   com CSP `default-src 'self'`.
10. **Testes realistas sem rede:** SQLite, fakeredis e FFmpeg real gerando áudio sintético (`lavfi`).

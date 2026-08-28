FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=surrealdb/surrealdb:v3 /surreal /surreal
COPY migrate.sh /migrate.sh
COPY start.sh /start.sh
COPY migrations/ /migrations/
EXPOSE 8080
CMD ["/bin/sh", "/start.sh"]

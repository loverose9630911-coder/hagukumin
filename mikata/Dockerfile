# ミカタ ― PHP だけで動くので、コンテナも小さくてすむ。
#
#   docker build -t mikata .
#   docker run -p 8080:8080 -v "$PWD/data:/app/data" mikata
#   → http://localhost:8080
#
# Render / Railway / Fly.io などにもこのまま置けます。
# ※ data/ を残しておかないと、タスクも会話も消えます（下の volume 指定が大事）。

FROM php:8.3-cli-bookworm

# セーブに使う pdo_sqlite だけ入れる（画像も外部ライブラリも使っていない）
RUN docker-php-ext-install -j"$(nproc)" pdo_sqlite \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

RUN mkdir -p data && chmod 777 data

ENV PORT=8080 \
    MIKATA_TZ=Asia/Tokyo \
    PHP_CLI_SERVER_WORKERS=4

EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD php -r 'exit(@file_get_contents("http://127.0.0.1:".getenv("PORT")."/api/me") ? 0 : 1);'

# 内蔵サーバーを使う（小さなチームなら十分。台数を増やすときは nginx + php-fpm へ）
CMD php -S "0.0.0.0:${PORT}" -t public public/index.php

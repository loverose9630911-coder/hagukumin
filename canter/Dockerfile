# canter ― PHP だけで動くので、コンテナも小さくてすむ。
#
#   docker build -t canter .
#   docker run -p 8090:8080 -v "$PWD/data:/app/data" canter
#   → http://localhost:8090
#
# Render / Railway / Fly.io などにもこのまま置けます。
# ※ data/ を残しておかないと、デザインも接続設定も消えます（上の -v 指定が大事）。
#    VOLUME 宣言はあえて書いていません（Render など、ディスクを付けない環境では
#    かえって起動の邪魔になることがあるため）。
#
# 【外に置くときは CANTER_PUBLIC_URL を必ず入れてください】
# Instagram・Threads・Notion は「画像の URL」を受け取って取りに来る作りなので、
# canter が外から見えるアドレスを知っている必要があります。

FROM php:8.3-cli-bookworm

# 保存に使う pdo_sqlite は、公式 PHP イメージに最初から入っている。
# 画像の大きさを読むのに使う gd だけは自分で入れる（JPEG と WebP も読めるように）。
RUN php -m | grep -qx pdo_sqlite \
 || { echo "pdo_sqlite が見つかりません。ベースイメージの構成が変わった可能性があります" >&2; exit 1; }

RUN apt-get update \
 && apt-get install -y --no-install-recommends libjpeg-dev libpng-dev libwebp-dev libfreetype6-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
 && docker-php-ext-install -j"$(nproc)" gd \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

RUN mkdir -p data && chmod 777 data

ENV PORT=8080 \
    CANTER_TZ=Asia/Tokyo \
    PHP_CLI_SERVER_WORKERS=4 \
    CANTER_SEED=

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD php -r 'exit(@file_get_contents("http://127.0.0.1:".getenv("PORT")."/api/me") ? 0 : 1);'

CMD ["/app/bin/start"]

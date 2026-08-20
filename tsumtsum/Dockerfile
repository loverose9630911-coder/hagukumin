# ぞうさんとなかまたち ― サーバー版（PHP + Python）をひとつのコンテナで動かす
#
#   docker build -t zousan .
#   docker run -p 8080:8080 -v "$PWD/data:/app/data" zousan
#   → http://localhost:8080
#
# Render / Railway / Fly.io などにもこのまま置けます。

FROM php:8.3-cli-bookworm

# PHP の拡張（画像を描く gd と、セーブに使う pdo_sqlite）と Python を入れる
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-install -j"$(nproc)" gd pdo_sqlite \
 && apt-get purge -y --auto-remove libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# キャラ定義の書き出しとキャラ画像の生成、エンジンのレイアウトの下ごしらえ
RUN python3 engine/export_config.py \
 && php tools/render_assets.php \
 && PYTHONPATH=engine python3 -c "from zousan import board; board.warm_cache()" \
 && mkdir -p data && chmod 777 data

ENV PORT=8080 \
    ENGINE_PORT=8765 \
    PHP_CLI_SERVER_WORKERS=4
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD php -r 'exit(@file_get_contents("http://127.0.0.1:".getenv("PORT")."/index.php") ? 0 : 1);'

CMD ["bin/serve"]

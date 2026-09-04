<?php
/**
 * 外部サービスへの通信。curl はここ以外から呼ばない。
 *
 * ・どのサービスも「うまくいったか」「だめなら何と言われたか」を同じ形で返す
 * ・待ち時間の上限を必ず入れる（相手が黙っても画面が固まらないように）
 * ・合言葉（トークン）はログに出さない
 */

declare(strict_types=1);

namespace Canter;

use CURLFile;

final class Http
{
    public const TIMEOUT = 30;

    /**
     * @param array $opt  json:配列 / form:配列 / multipart:配列 / headers:配列 / timeout:秒
     * @return array{status:int, body:string, json:?array, headers:array}
     */
    public static function request(string $method, string $url, array $opt = []): array
    {
        if (!function_exists('curl_init')) {
            throw new ApiError('この環境では外部との通信ができません（php-curl が必要です）', 500);
        }
        if (!preg_match('#\Ahttps?://#i', $url)) {
            throw new ApiError('接続先のアドレスが正しくありません', 422);
        }

        $ch      = curl_init();
        $headers = $opt['headers'] ?? [];
        $body    = null;

        if (isset($opt['json'])) {
            $body      = json_encode($opt['json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $headers[] = 'Content-Type: application/json; charset=utf-8';
        } elseif (isset($opt['form'])) {
            $body      = http_build_query($opt['form']);
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        } elseif (isset($opt['multipart'])) {
            $body = $opt['multipart'];   // curl が自分で Content-Type を付ける
        }

        $got = [];

        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => (int) ($opt['timeout'] ?? self::TIMEOUT),
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_USERAGENT      => 'canter/1.0',
            CURLOPT_HEADERFUNCTION => static function ($_ch, string $line) use (&$got): int {
                $len = strlen($line);
                $p   = strpos($line, ':');
                if ($p !== false) {
                    $got[strtolower(trim(substr($line, 0, $p)))][] = trim(substr($line, $p + 1));
                }
                return $len;
            },
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        if (!empty($opt['cookie'])) {
            curl_setopt($ch, CURLOPT_COOKIE, (string) $opt['cookie']);
        }

        $out    = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($out === false) {
            throw new ApiError('相手のサーバーにつながりませんでした：' . ($err !== '' ? $err : '理由は分かりません'), 502);
        }

        $json = json_decode((string) $out, true);

        return [
            'status'  => $status,
            'body'    => (string) $out,
            'json'    => is_array($json) ? $json : null,
            'headers' => $got,
        ];
    }

    public static function get(string $url, array $opt = []): array
    {
        return self::request('GET', $url, $opt);
    }

    public static function post(string $url, array $opt = []): array
    {
        return self::request('POST', $url, $opt);
    }

    /** ファイルを1つ添えて送るときの部品。 */
    public static function file(string $path, string $mime, string $name): CURLFile
    {
        return new CURLFile($path, $mime, $name);
    }

    /**
     * 相手が返してきたエラーの本文から、人が読める1行を取り出す。
     * サービスごとに置き場所が違うので、よくある形をひととおり見る。
     */
    public static function errorMessage(array $res): string
    {
        $j = $res['json'];
        if (is_array($j)) {
            foreach ([['error', 'message'], ['error', 'error_user_msg'], ['message'], ['detail'], ['title'], ['error_description']] as $keys) {
                $v = $j;
                foreach ($keys as $k) {
                    if (!is_array($v) || !isset($v[$k])) {
                        $v = null;
                        break;
                    }
                    $v = $v[$k];
                }
                if (is_string($v) && $v !== '') {
                    return $v;
                }
            }
            if (isset($j['errors'][0]['message']) && is_string($j['errors'][0]['message'])) {
                return $j['errors'][0]['message'];
            }
            if (isset($j['error']) && is_string($j['error']) && $j['error'] !== '') {
                return $j['error'];
            }
        }

        $body = trim($res['body']);
        return $body === '' ? 'HTTP ' . $res['status'] : mb_substr($body, 0, 300);
    }
}

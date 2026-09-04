<?php
/**
 * 外部サービスとの接続の出し入れ。
 *
 * 合言葉（トークン・パスワード）は Secret で暗号化して1列にしまう。
 * 画面に返すときは password の項目を必ず伏せ、「入っているかどうか」だけを渡す。
 * 直すときに空のまま送られてきたら、前の値をそのまま残す（消えてしまわないように）。
 */

declare(strict_types=1);

namespace Canter;

use Canter\Connector\Connector;
use Canter\Connector\Instagram;
use Canter\Connector\Mikata;
use Canter\Connector\Note;
use Canter\Connector\Notion;
use Canter\Connector\Threads;
use Canter\Connector\XCom;

final class Connections
{
    /** つなげる先。増やすときはここに1行足す。 */
    private const SERVICES = [
        'instagram' => Instagram::class,
        'x'         => XCom::class,
        'threads'   => Threads::class,
        'notion'    => Notion::class,
        'note'      => Note::class,
        'mikata'    => Mikata::class,
    ];

    public static function make(string $service): Connector
    {
        $class = self::SERVICES[$service] ?? null;
        if ($class === null) {
            throw new ApiError('知らないサービスです：' . $service, 404);
        }
        return new $class();
    }

    /** 画面がフォームを組み立てるための一覧。 */
    public static function catalog(): array
    {
        $out = [];
        foreach (self::SERVICES as $service => $class) {
            $out[] = [
                'service'           => $service,
                'label'             => $class::label(),
                'capabilities'      => $class::capabilities(),
                'fields'            => $class::fields(),
                'needs_public_image'=> $class::needsPublicImage(),
                'requires_image'    => $class::requiresImage(),
                'caption_limit'     => $class::captionLimit(),
            ];
        }
        return $out;
    }

    public static function list(int $workspaceId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM connections WHERE workspace_id = ? ORDER BY id');
        $sel->execute([$workspaceId]);

        return array_map(static fn(array $r): array => self::pub($r), $sel->fetchAll());
    }

    public static function create(int $workspaceId, array $body): array
    {
        $service = (string) ($body['service'] ?? '');
        self::make($service);   // 知らないサービスならここで止まる

        $label = mb_substr(trim((string) ($body['label'] ?? '')), 0, 40);
        $config = self::clean($service, (array) ($body['config'] ?? []), []);

        $db  = Db::conn();
        $sel = $db->prepare('SELECT 1 FROM connections WHERE workspace_id = ? AND service = ? AND label = ?');
        $sel->execute([$workspaceId, $service, $label]);
        if ($sel->fetchColumn()) {
            throw new ApiError('同じ名前の接続がすでにあります。名前を変えてください', 409);
        }

        $ins = $db->prepare(
            'INSERT INTO connections (workspace_id, service, label, config, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([$workspaceId, $service, $label, Secret::encrypt($config), 'unchecked', Clock::now()]);

        return self::get($workspaceId, (int) $db->lastInsertId());
    }

    public static function get(int $workspaceId, int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM connections WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row || (int) $row['workspace_id'] !== $workspaceId) {
            throw new ApiError('接続が見つかりません', 404);
        }
        return self::pub($row);
    }

    public static function update(int $workspaceId, int $id, array $body): array
    {
        $row = self::row($workspaceId, $id);
        $old = Secret::decrypt((string) $row['config']);

        $label  = array_key_exists('label', $body)
            ? mb_substr(trim((string) $body['label']), 0, 40)
            : (string) $row['label'];
        $config = array_key_exists('config', $body)
            ? self::clean((string) $row['service'], (array) $body['config'], $old)
            : $old;

        $upd = Db::conn()->prepare(
            'UPDATE connections SET label = ?, config = ?, status = ?, message = ?, checked_at = NULL WHERE id = ?'
        );
        $upd->execute([$label, Secret::encrypt($config), 'unchecked', '', $id]);

        return self::get($workspaceId, $id);
    }

    public static function delete(int $workspaceId, int $id): void
    {
        self::row($workspaceId, $id);
        $del = Db::conn()->prepare('DELETE FROM connections WHERE id = ?');
        $del->execute([$id]);
    }

    /** 実際につないでみる。結果は DB にも残す。 */
    public static function verify(int $workspaceId, int $id): array
    {
        $row       = self::row($workspaceId, $id);
        $service   = (string) $row['service'];
        $connector = self::make($service);
        $config    = Secret::decrypt((string) $row['config']);

        try {
            $result = $connector->verify($config);
        } catch (ApiError $e) {
            $result = ['ok' => false, 'message' => $e->getMessage(), 'info' => []];
        }

        // X はトークンを取り直すことがあるので、新しくなっていれば保存しておく。
        if ($connector instanceof XCom && $connector->refreshed !== []) {
            $config = array_merge($config, $connector->refreshed);
            $save   = Db::conn()->prepare('UPDATE connections SET config = ? WHERE id = ?');
            $save->execute([Secret::encrypt($config), $id]);
        }

        $upd = Db::conn()->prepare('UPDATE connections SET status = ?, message = ?, checked_at = ? WHERE id = ?');
        $upd->execute([$result['ok'] ? 'ok' : 'ng', mb_substr($result['message'], 0, 400), Clock::now(), $id]);

        return [
            'connection' => self::get($workspaceId, $id),
            'ok'         => (bool) $result['ok'],
            'message'    => $result['message'],
            'info'       => $result['info'] ?? [],
        ];
    }

    /** 投稿するときに使う、隠していない設定。外に出さないこと。 */
    public static function secretConfig(int $workspaceId, int $id): array
    {
        $row = self::row($workspaceId, $id);
        return Secret::decrypt((string) $row['config']);
    }

    /** 取り直したトークンを保存する（Publish から呼ばれる）。 */
    public static function mergeConfig(int $workspaceId, int $id, array $patch): void
    {
        if ($patch === []) {
            return;
        }
        $row = self::row($workspaceId, $id);
        $cfg = array_merge(Secret::decrypt((string) $row['config']), $patch);
        $upd = Db::conn()->prepare('UPDATE connections SET config = ? WHERE id = ?');
        $upd->execute([Secret::encrypt($cfg), $id]);
    }

    // ---- 中身 ---------------------------------------------------------------

    private static function row(int $workspaceId, int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM connections WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row || (int) $row['workspace_id'] !== $workspaceId) {
            throw new ApiError('接続が見つかりません', 404);
        }
        return $row;
    }

    /**
     * 決められた項目だけを取り出す。
     * password の項目が空のまま送られてきたら、前の値を残す。
     */
    private static function clean(string $service, array $in, array $old): array
    {
        $class = self::SERVICES[$service];
        $out   = [];

        foreach ($class::fields() as $f) {
            $key  = $f['key'];
            $type = $f['type'] ?? 'text';
            $val  = isset($in[$key]) && is_scalar($in[$key]) ? trim((string) $in[$key]) : '';

            if ($type === 'password' && $val === '' && isset($old[$key])) {
                $out[$key] = $old[$key];
                continue;
            }

            if ($val === '' && isset($f['default'])) {
                $val = (string) $f['default'];
            }

            if ($val === '' && !empty($f['required'])) {
                throw new ApiError($f['label'] . ' を入れてください', 422);
            }

            if ($type === 'url' && $val !== '' && !preg_match('#\Ahttps?://#i', $val)) {
                throw new ApiError($f['label'] . ' は http:// か https:// から始まる形で入れてください', 422);
            }

            if ($type === 'select' && $val !== '') {
                $ok = array_column($f['options'] ?? [], 'value');
                if ($ok !== [] && !in_array($val, $ok, true)) {
                    throw new ApiError($f['label'] . ' の選び方が正しくありません', 422);
                }
            }

            $out[$key] = mb_substr($val, 0, 4000);
        }

        return $out;
    }

    /** 画面に返す形。合言葉は絶対に混ぜない。 */
    private static function pub(array $row): array
    {
        $service = (string) $row['service'];
        $class   = self::SERVICES[$service] ?? null;
        $config  = Secret::decrypt((string) $row['config']);

        $safe = [];
        $has  = [];
        foreach (($class ? $class::fields() : []) as $f) {
            $key = $f['key'];
            if (($f['type'] ?? 'text') === 'password') {
                $has[$key] = isset($config[$key]) && $config[$key] !== '';
                continue;   // 中身は返さない
            }
            $safe[$key] = $config[$key] ?? '';
        }

        return [
            'id'         => (int) $row['id'],
            'service'    => $service,
            'label'      => $row['label'],
            'name'       => $class ? $class::label() : $service,
            'config'     => $safe,
            'has_secret' => $has,
            'status'     => $row['status'],
            'message'    => $row['message'],
            'checked_at' => $row['checked_at'],
            'created_at' => $row['created_at'],
        ];
    }
}

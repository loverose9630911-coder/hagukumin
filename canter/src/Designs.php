<?php
/**
 * デザイン（キャンバス1枚）の出し入れ。
 *
 * 中身は doc に JSON でまるごと入れる。図形ごとにテーブルを分けないのは、
 * 「1枚まるごと」でしか読み書きしないから。保存も取り出しも1行で済む。
 *
 * 保存のたびに履歴（versions）を残すが、打つたびに増えては困るので
 * 「前の履歴から3分たった」か「別の人が保存した」ときだけ足す。
 */

declare(strict_types=1);

namespace Canter;

final class Designs
{
    private const VERSION_GAP_SEC = 180;   // これより短い間隔の保存は履歴にしない
    private const VERSION_KEEP    = 30;    // 1枚あたりに残す履歴の数

    public static function list(int $workspaceId, bool $archived = false, string $q = ''): array
    {
        $sql  = 'SELECT * FROM designs WHERE workspace_id = ? AND archived = ?';
        $args = [$workspaceId, $archived ? 1 : 0];

        $q = trim($q);
        if ($q !== '') {
            $sql .= ' AND title LIKE ?';
            $args[] = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
        }
        $sql .= ' ORDER BY updated_at DESC, id DESC LIMIT 300';

        $sel = Db::conn()->prepare($sql);
        $sel->execute($args);

        return array_map(static fn(array $r): array => self::pub($r, false), $sel->fetchAll());
    }

    public static function create(int $workspaceId, int $userId, array $body): array
    {
        $presetId = (string) ($body['preset'] ?? 'ig_square');
        $preset   = Templates::preset($presetId);

        $w = $preset['w'] ?? 1080;
        $h = $preset['h'] ?? 1080;
        if ($preset === null) {
            $presetId = 'custom';
            $w = (int) ($body['w'] ?? 1080);
            $h = (int) ($body['h'] ?? 1080);
        }

        // テンプレートを選んでいればその中身、選んでいなければ白紙。
        $doc = null;
        if (!empty($body['template'])) {
            $doc = Templates::doc((string) $body['template']);
            if ($doc === null) {
                throw new ApiError('そのテンプレートは見つかりません', 404);
            }
            $w = (int) $doc['w'];
            $h = (int) $doc['h'];
        }
        if ($doc === null) {
            $doc = isset($body['doc']) ? Doc::sanitize($body['doc']) : Templates::blank($w, $h);
            $w = (int) $doc['w'];
            $h = (int) $doc['h'];
        }
        $doc = Doc::sanitize($doc);

        $title = mb_substr(trim((string) ($body['title'] ?? '')), 0, 80);
        if ($title === '') {
            $title = '無題のデザイン';
        }

        $db  = Db::conn();
        $ins = $db->prepare(
            'INSERT INTO designs (workspace_id, title, preset, w, h, doc, creator_id, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $workspaceId, $title, $presetId, $w, $h,
            json_encode($doc, JSON_UNESCAPED_UNICODE),
            $userId, $userId, Clock::now(), Clock::now(),
        ]);

        return self::get($workspaceId, (int) $db->lastInsertId());
    }

    public static function get(int $workspaceId, int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM designs WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row || (int) $row['workspace_id'] !== $workspaceId) {
            throw new ApiError('デザインが見つかりません', 404);
        }
        return self::pub($row, true);
    }

    public static function update(int $workspaceId, int $userId, int $id, array $body): array
    {
        $cur = self::get($workspaceId, $id);

        $title    = $cur['title'];
        $archived = $cur['archived'];
        $doc      = $cur['doc'];
        $w        = $cur['w'];
        $h        = $cur['h'];
        $preset   = $cur['preset'];
        $thumb    = $cur['thumb_asset'];

        if (array_key_exists('title', $body)) {
            $title = mb_substr(trim((string) $body['title']), 0, 80) ?: '無題のデザイン';
        }
        if (array_key_exists('archived', $body)) {
            $archived = !empty($body['archived']);
        }
        if (array_key_exists('preset', $body)) {
            $preset = mb_substr((string) $body['preset'], 0, 24) ?: 'custom';
        }
        if (array_key_exists('thumb_asset', $body)) {
            $thumbId = (int) $body['thumb_asset'];
            $thumb   = $thumbId > 0 ? Assets::owned($workspaceId, $thumbId)['id'] : null;
        }

        $docChanged = false;
        if (array_key_exists('doc', $body)) {
            $next = Doc::sanitize($body['doc']);
            // 画像は、そのワークスペースのものだけを置ける。
            foreach (Doc::usedAssets($next) as $assetId) {
                Assets::owned($workspaceId, $assetId);
            }
            $docChanged = json_encode($next, JSON_UNESCAPED_UNICODE) !== json_encode($doc, JSON_UNESCAPED_UNICODE);
            $doc = $next;
            $w   = (int) $doc['w'];
            $h   = (int) $doc['h'];
        }

        if ($docChanged) {
            self::keepVersion($id, $userId, $cur['doc'], (string) ($body['version_label'] ?? ''));
        }

        $upd = Db::conn()->prepare(
            'UPDATE designs SET title = ?, preset = ?, w = ?, h = ?, doc = ?, thumb_asset = ?,
                                archived = ?, updated_by = ?, updated_at = ?
              WHERE id = ?'
        );
        $upd->execute([
            $title, $preset, $w, $h,
            json_encode($doc, JSON_UNESCAPED_UNICODE),
            $thumb, $archived ? 1 : 0, $userId, Clock::now(), $id,
        ]);

        return self::get($workspaceId, $id);
    }

    public static function duplicate(int $workspaceId, int $userId, int $id, string $title = ''): array
    {
        $src = self::get($workspaceId, $id);

        $db  = Db::conn();
        $ins = $db->prepare(
            'INSERT INTO designs (workspace_id, title, preset, w, h, doc, thumb_asset, creator_id, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $workspaceId,
            mb_substr(trim($title), 0, 80) ?: ($src['title'] . ' のコピー'),
            $src['preset'], $src['w'], $src['h'],
            json_encode($src['doc'], JSON_UNESCAPED_UNICODE),
            $src['thumb_asset'], $userId, $userId, Clock::now(), Clock::now(),
        ]);

        return self::get($workspaceId, (int) $db->lastInsertId());
    }

    public static function delete(int $workspaceId, int $id): void
    {
        self::get($workspaceId, $id);
        $del = Db::conn()->prepare('DELETE FROM designs WHERE id = ?');
        $del->execute([$id]);
    }

    // ---- 履歴 ---------------------------------------------------------------

    public static function versions(int $workspaceId, int $designId): array
    {
        self::get($workspaceId, $designId);

        $sel = Db::conn()->prepare(
            'SELECT v.id, v.user_id, v.label, v.created_at, u.name AS user_name
               FROM versions v LEFT JOIN users u ON u.id = v.user_id
              WHERE v.design_id = ? ORDER BY v.id DESC'
        );
        $sel->execute([$designId]);

        return array_map(static fn(array $r): array => [
            'id'         => (int) $r['id'],
            'user_id'    => (int) $r['user_id'],
            'user_name'  => $r['user_name'] ?? '（不明）',
            'label'      => $r['label'],
            'created_at' => $r['created_at'],
        ], $sel->fetchAll());
    }

    public static function restore(int $workspaceId, int $userId, int $designId, int $versionId): array
    {
        self::get($workspaceId, $designId);

        $sel = Db::conn()->prepare('SELECT * FROM versions WHERE id = ? AND design_id = ?');
        $sel->execute([$versionId, $designId]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('その履歴は見つかりません', 404);
        }

        $doc = json_decode((string) $row['doc'], true);

        // 戻す前のものも履歴に残す（「戻したけどやっぱり」に応えられるように）。
        return self::update($workspaceId, $userId, $designId, [
            'doc'           => $doc,
            'version_label' => '復元の前',
        ]);
    }

    private static function keepVersion(int $designId, int $userId, array $doc, string $label): void
    {
        $db  = Db::conn();
        $sel = $db->prepare('SELECT id, user_id, created_at FROM versions WHERE design_id = ? ORDER BY id DESC LIMIT 1');
        $sel->execute([$designId]);
        $last = $sel->fetch();

        if ($last && $label === '') {
            $sameUser = (int) $last['user_id'] === $userId;
            $fresh    = Clock::ts() - (int) strtotime((string) $last['created_at']) < self::VERSION_GAP_SEC;
            if ($sameUser && $fresh) {
                return;   // 続けて保存しているだけなので、履歴は増やさない
            }
        }

        $ins = $db->prepare('INSERT INTO versions (design_id, user_id, label, doc, created_at) VALUES (?, ?, ?, ?, ?)');
        $ins->execute([$designId, $userId, mb_substr($label, 0, 40), json_encode($doc, JSON_UNESCAPED_UNICODE), Clock::now()]);

        // 古いものから消して、決めた数だけ残す。
        $old = $db->prepare(
            'DELETE FROM versions WHERE design_id = ? AND id NOT IN
             (SELECT id FROM versions WHERE design_id = ? ORDER BY id DESC LIMIT ?)'
        );
        $old->execute([$designId, $designId, self::VERSION_KEEP]);
    }

    /**
     * 中身から「色と位置だけ」を取り出す。
     * 画像を作るわけではないので軽く、それでいて何が置いてあるかは伝わる。
     */
    private static function preview(mixed $doc, int $w, int $h): array
    {
        if (!is_array($doc)) {
            return ['bg' => '#ffffff', 'shapes' => []];
        }

        $shapes = [];
        foreach (array_slice($doc['nodes'] ?? [], 0, 8) as $n) {
            if (!is_array($n) || !empty($n['hidden'])) {
                continue;
            }
            $fill = $n['fill'] ?? null;
            $color = is_string($fill) ? $fill
                : (is_array($fill) ? ($fill['a'] ?? null) : ($n['color'] ?? null));
            if (!is_string($color)) {
                continue;
            }
            $shapes[] = [
                'x'     => round(((float) ($n['x'] ?? 0)) / max($w, 1) * 100, 2),
                'y'     => round(((float) ($n['y'] ?? 0)) / max($h, 1) * 100, 2),
                'w'     => round(((float) ($n['w'] ?? 0)) / max($w, 1) * 100, 2),
                'h'     => round(((float) ($n['h'] ?? 0)) / max($h, 1) * 100, 2),
                'color' => $color,
                'round' => ($n['type'] ?? '') === 'ellipse',
                'op'    => (float) ($n['opacity'] ?? 1),
            ];
        }

        return ['bg' => $doc['bg'] ?? '#ffffff', 'shapes' => $shapes];
    }

    private static function pub(array $row, bool $withDoc): array
    {
        $out = [
            'id'          => (int) $row['id'],
            'workspace_id'=> (int) $row['workspace_id'],
            'title'       => $row['title'],
            'preset'      => $row['preset'],
            'w'           => (int) $row['w'],
            'h'           => (int) $row['h'],
            'thumb_asset' => $row['thumb_asset'] === null ? null : (int) $row['thumb_asset'],
            'thumb_url'   => null,
            'archived'    => (int) $row['archived'] === 1,
            'creator_id'  => (int) $row['creator_id'],
            'updated_by'  => $row['updated_by'] === null ? null : (int) $row['updated_by'],
            'created_at'  => $row['created_at'],
            'updated_at'  => $row['updated_at'],
        ];

        if ($out['thumb_asset'] !== null) {
            $sel = Db::conn()->prepare('SELECT token FROM assets WHERE id = ?');
            $sel->execute([$out['thumb_asset']]);
            $token = $sel->fetchColumn();
            if (is_string($token)) {
                $out['thumb_url'] = '/a/' . $token;
            }
        }

        if ($withDoc) {
            $doc = json_decode((string) $row['doc'], true);
            $out['doc'] = is_array($doc) ? $doc : Templates::blank($out['w'], $out['h']);
        } elseif ($out['thumb_url'] === null) {
            // 見本の画像はブラウザ側で作るので、一度も開いていないものには無い。
            // そのぶん、色と位置だけの「雰囲気」を返して、一覧が空白にならないようにする。
            $out['preview'] = self::preview(json_decode((string) $row['doc'], true), $out['w'], $out['h']);
        }

        return $out;
    }
}

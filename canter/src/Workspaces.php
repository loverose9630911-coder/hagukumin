<?php
/**
 * ワークスペース（いっしょに作る人のまとまり）とブランドキット。
 *
 * ここに属するデータは、API の入口 1か所（assertMember）で必ずメンバーか確かめる。
 */

declare(strict_types=1);

namespace Canter;

final class Workspaces
{
    /** 参加コード。読み間違えやすい文字（0/O/1/I）は最初から入れない。 */
    private const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function create(int $userId, string $name): array
    {
        $name = trim($name) !== '' ? trim($name) : 'マイワークスペース';
        if (mb_strlen($name) > 40) {
            throw new ApiError('ワークスペース名は40文字までです', 422);
        }

        $db = Db::conn();
        $ins = $db->prepare('INSERT INTO workspaces (name, join_code, created_at) VALUES (?, ?, ?)');
        $ins->execute([$name, self::freshCode(), Clock::now()]);
        $id = (int) $db->lastInsertId();

        $mem = $db->prepare('INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
        $mem->execute([$id, $userId, 'owner', Clock::now()]);

        // ブランドキットは最初から1つ用意しておく（空だと何もできないため）。
        $br = $db->prepare(
            'INSERT INTO brands (workspace_id, name, colors, font_head, font_body, created_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $br->execute([
            $id,
            'ブランド',
            json_encode(['#1f2430', '#f0508c', '#7c5cff', '#00b8a9', '#ffffff'], JSON_UNESCAPED_SLASHES),
            'rounded',
            'sans',
            Clock::now(),
        ]);

        return self::get($id);
    }

    public static function join(int $userId, string $code): array
    {
        $code = strtoupper(trim($code));
        $sel  = Db::conn()->prepare('SELECT * FROM workspaces WHERE join_code = ?');
        $sel->execute([$code]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('その参加コードのワークスペースは見つかりません', 404);
        }

        $ins = Db::conn()->prepare(
            'INSERT OR IGNORE INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
        );
        $ins->execute([(int) $row['id'], $userId, 'member', Clock::now()]);

        return self::get((int) $row['id']);
    }

    public static function get(int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM workspaces WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('ワークスペースが見つかりません', 404);
        }
        return [
            'id'        => (int) $row['id'],
            'name'      => $row['name'],
            'join_code' => $row['join_code'],
        ];
    }

    public static function forUser(int $userId): array
    {
        $sel = Db::conn()->prepare(
            'SELECT w.* FROM workspaces w
               JOIN members m ON m.workspace_id = w.id
              WHERE m.user_id = ?
              ORDER BY w.id'
        );
        $sel->execute([$userId]);

        return array_map(static fn(array $r): array => [
            'id'        => (int) $r['id'],
            'name'      => $r['name'],
            'join_code' => $r['join_code'],
        ], $sel->fetchAll());
    }

    public static function members(int $workspaceId): array
    {
        $sel = Db::conn()->prepare(
            'SELECT u.id, u.login, u.name, u.color, m.role
               FROM members m JOIN users u ON u.id = m.user_id
              WHERE m.workspace_id = ?
              ORDER BY m.joined_at'
        );
        $sel->execute([$workspaceId]);

        return array_map(static fn(array $r): array => [
            'id'    => (int) $r['id'],
            'login' => $r['login'],
            'name'  => $r['name'],
            'color' => $r['color'],
            'role'  => $r['role'],
        ], $sel->fetchAll());
    }

    /** メンバーでなければ例外。API の入口から必ず通す。 */
    public static function assertMember(int $workspaceId, int $userId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM members WHERE workspace_id = ? AND user_id = ?');
        $sel->execute([$workspaceId, $userId]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('このワークスペースを見る権限がありません', 403);
        }
        return $row;
    }

    // ---- ブランドキット ----------------------------------------------------

    public static function brand(int $workspaceId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM brands WHERE workspace_id = ? ORDER BY id LIMIT 1');
        $sel->execute([$workspaceId]);
        $row = $sel->fetch();
        if (!$row) {
            // 古いワークスペースなど、無ければその場で作る。
            $ins = Db::conn()->prepare(
                'INSERT INTO brands (workspace_id, colors, created_at) VALUES (?, ?, ?)'
            );
            $ins->execute([$workspaceId, json_encode(['#1f2430', '#f0508c', '#7c5cff']), Clock::now()]);
            return self::brand($workspaceId);
        }

        $colors = json_decode((string) $row['colors'], true);

        return [
            'id'         => (int) $row['id'],
            'name'       => $row['name'],
            'colors'     => is_array($colors) ? array_values($colors) : [],
            'font_head'  => $row['font_head'],
            'font_body'  => $row['font_body'],
            'logo_asset' => $row['logo_asset'] === null ? null : (int) $row['logo_asset'],
        ];
    }

    public static function updateBrand(int $workspaceId, array $body): array
    {
        $cur = self::brand($workspaceId);

        $colors = $body['colors'] ?? $cur['colors'];
        if (!is_array($colors)) {
            throw new ApiError('色の指定が読めませんでした', 422);
        }
        // 画面では色そのものを見比べて「いま選ばれている色」を出すので、
        // 大文字・小文字がまざらないよう、しまうときに小文字へそろえる。
        $colors = array_values(array_filter(
            array_map(static fn($c): string => is_string($c) ? strtolower(trim($c)) : '', $colors),
            static fn(string $c): bool => preg_match('/\A#[0-9a-f]{6}\z/', $c) === 1
        ));
        if (count($colors) > 12) {
            throw new ApiError('ブランドカラーは12色までです', 422);
        }

        // 書体は決まった中からだけ。知らないものが来たら、いまのままにする。
        $fonts = ['sans', 'serif', 'rounded', 'mono'];
        $pick  = static function (mixed $given, string $now) use ($fonts): string {
            return is_string($given) && in_array($given, $fonts, true) ? $given : $now;
        };
        $head  = $pick($body['font_head'] ?? null, $cur['font_head']);
        $body_ = $pick($body['font_body'] ?? null, $cur['font_body']);

        $upd = Db::conn()->prepare(
            'UPDATE brands SET name = ?, colors = ?, font_head = ?, font_body = ?, logo_asset = ? WHERE id = ?'
        );
        $upd->execute([
            mb_substr(trim((string) ($body['name'] ?? $cur['name'])), 0, 40) ?: 'ブランド',
            json_encode($colors, JSON_UNESCAPED_SLASHES),
            $head,
            $body_,
            isset($body['logo_asset']) ? ((int) $body['logo_asset'] ?: null) : $cur['logo_asset'],
            $cur['id'],
        ]);

        return self::brand($workspaceId);
    }

    private static function freshCode(): string
    {
        $db = Db::conn();
        for ($i = 0; $i < 40; $i++) {
            $code = '';
            for ($j = 0; $j < 6; $j++) {
                $code .= self::CODE_CHARS[random_int(0, strlen(self::CODE_CHARS) - 1)];
            }
            $sel = $db->prepare('SELECT 1 FROM workspaces WHERE join_code = ?');
            $sel->execute([$code]);
            if (!$sel->fetchColumn()) {
                return $code;
            }
        }
        throw new ApiError('参加コードを作れませんでした', 500);
    }
}

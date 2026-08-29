<?php
/**
 * チームとプロジェクト（＝チャンネル）。
 *
 * このアプリではプロジェクトが「タスクの入れ物（Notion のデータベース）」と
 * 「会話の場所（Slack のチャンネル）」を兼ねている。
 */

declare(strict_types=1);

namespace Mikata;

final class Teams
{
    /** 見間違えやすい文字（0/O/1/I）を抜いた参加コード用の文字。 */
    private const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function create(int $userId, string $name): array
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 40) {
            throw new ApiError('チーム名は1〜40文字で入れてください', 422);
        }

        $db = Db::conn();
        $db->beginTransaction();
        try {
            $ins = $db->prepare('INSERT INTO teams (name, join_code, created_at) VALUES (?, ?, ?)');
            $ins->execute([$name, self::freshCode(), Clock::now()]);
            $teamId = (int) $db->lastInsertId();

            $mem = $db->prepare(
                'INSERT INTO members (team_id, user_id, role, capacity_h, joined_at) VALUES (?, ?, ?, ?, ?)'
            );
            $mem->execute([$teamId, $userId, 'owner', 30, Clock::now()]);

            self::addProject($teamId, '全体連絡', '📣', '#0ea5e9', 0);
            self::addProject($teamId, '今期の仕事', '🚀', '#6366f1', 1);

            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        return self::get($teamId);
    }

    public static function join(int $userId, string $code): array
    {
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');
        $sel  = Db::conn()->prepare('SELECT * FROM teams WHERE join_code = ?');
        $sel->execute([$code]);
        $team = $sel->fetch();
        if (!$team) {
            throw new ApiError('その参加コードのチームは見つかりませんでした', 404);
        }

        $ins = Db::conn()->prepare(
            'INSERT OR IGNORE INTO members (team_id, user_id, role, capacity_h, joined_at) VALUES (?, ?, ?, ?, ?)'
        );
        $ins->execute([(int) $team['id'], $userId, 'member', 30, Clock::now()]);

        return self::get((int) $team['id']);
    }

    /** そのユーザーが入っているチーム一覧。 */
    public static function forUser(int $userId): array
    {
        $sel = Db::conn()->prepare(
            'SELECT t.*, m.role FROM members m JOIN teams t ON t.id = m.team_id
             WHERE m.user_id = ? ORDER BY t.id'
        );
        $sel->execute([$userId]);

        return array_map(static fn(array $r): array => [
            'id'        => (int) $r['id'],
            'name'      => $r['name'],
            'join_code' => $r['join_code'],
            'role'      => $r['role'],
        ], $sel->fetchAll());
    }

    public static function get(int $teamId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM teams WHERE id = ?');
        $sel->execute([$teamId]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('チームが見つかりません', 404);
        }
        return [
            'id'        => (int) $row['id'],
            'name'      => $row['name'],
            'join_code' => $row['join_code'],
        ];
    }

    /** チームに入っていない人を弾く。全ての API の入口で必ず通す。 */
    public static function assertMember(int $teamId, int $userId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM members WHERE team_id = ? AND user_id = ?');
        $sel->execute([$teamId, $userId]);
        $row = $sel->fetch();
        if (!$row) {
            throw new ApiError('このチームを見る権限がありません', 403);
        }
        return $row;
    }

    public static function members(int $teamId): array
    {
        $sel = Db::conn()->prepare(
            'SELECT u.id, u.login, u.name, u.color, m.role, m.capacity_h
             FROM members m JOIN users u ON u.id = m.user_id
             WHERE m.team_id = ? ORDER BY m.joined_at, u.id'
        );
        $sel->execute([$teamId]);

        return array_map(static fn(array $r): array => [
            'id'         => (int) $r['id'],
            'login'      => $r['login'],
            'name'       => $r['name'],
            'color'      => $r['color'],
            'role'       => $r['role'],
            'capacity_h' => (float) $r['capacity_h'],
        ], $sel->fetchAll());
    }

    public static function updateMember(int $teamId, int $actorId, int $userId, array $patch): array
    {
        $actor = self::assertMember($teamId, $actorId);
        // 自分の設定はいつでも、他人の設定はオーナーだけが変えられる。
        if ($userId !== $actorId && $actor['role'] !== 'owner') {
            throw new ApiError('他のメンバーの設定を変えられるのはオーナーだけです', 403);
        }
        self::assertMember($teamId, $userId);

        if (array_key_exists('capacity_h', $patch)) {
            $cap = (float) $patch['capacity_h'];
            if ($cap < 0 || $cap > 168) {
                throw new ApiError('1週間に使える時間は 0〜168 で入れてください', 422);
            }
            $up = Db::conn()->prepare('UPDATE members SET capacity_h = ? WHERE team_id = ? AND user_id = ?');
            $up->execute([$cap, $teamId, $userId]);
        }

        if (array_key_exists('role', $patch)) {
            if ($actor['role'] !== 'owner') {
                throw new ApiError('役割を変えられるのはオーナーだけです', 403);
            }
            $role = $patch['role'] === 'owner' ? 'owner' : 'member';
            if ($role === 'member' && $userId === $actorId && self::ownerCount($teamId) <= 1) {
                throw new ApiError('オーナーが0人になってしまうので変更できません', 422);
            }
            $up = Db::conn()->prepare('UPDATE members SET role = ? WHERE team_id = ? AND user_id = ?');
            $up->execute([$role, $teamId, $userId]);
        }

        return self::members($teamId);
    }

    private static function ownerCount(int $teamId): int
    {
        $sel = Db::conn()->prepare("SELECT COUNT(*) FROM members WHERE team_id = ? AND role = 'owner'");
        $sel->execute([$teamId]);
        return (int) $sel->fetchColumn();
    }

    // ---- プロジェクト（＝チャンネル） -------------------------------------

    public static function projects(int $teamId): array
    {
        $sel = Db::conn()->prepare(
            'SELECT * FROM projects WHERE team_id = ? ORDER BY archived, sort_order, id'
        );
        $sel->execute([$teamId]);

        return array_map(static fn(array $r): array => [
            'id'       => (int) $r['id'],
            'name'     => $r['name'],
            'emoji'    => $r['emoji'],
            'color'    => $r['color'],
            'archived' => (int) $r['archived'] === 1,
        ], $sel->fetchAll());
    }

    public static function createProject(int $teamId, array $in): array
    {
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 40) {
            throw new ApiError('プロジェクト名は1〜40文字で入れてください', 422);
        }
        $next = Db::conn()->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects WHERE team_id = ?');
        $next->execute([$teamId]);

        $id = self::addProject(
            $teamId,
            $name,
            self::oneEmoji((string) ($in['emoji'] ?? '📁')),
            self::color((string) ($in['color'] ?? '#6366f1')),
            (float) $next->fetchColumn()
        );

        return self::projectById($teamId, $id);
    }

    public static function updateProject(int $teamId, int $projectId, array $patch): array
    {
        self::projectById($teamId, $projectId);

        $sets = [];
        $args = [];
        if (isset($patch['name'])) {
            $name = trim((string) $patch['name']);
            if ($name === '' || mb_strlen($name) > 40) {
                throw new ApiError('プロジェクト名は1〜40文字で入れてください', 422);
            }
            $sets[] = 'name = ?';
            $args[] = $name;
        }
        if (isset($patch['emoji'])) {
            $sets[] = 'emoji = ?';
            $args[] = self::oneEmoji((string) $patch['emoji']);
        }
        if (isset($patch['color'])) {
            $sets[] = 'color = ?';
            $args[] = self::color((string) $patch['color']);
        }
        if (array_key_exists('archived', $patch)) {
            $sets[] = 'archived = ?';
            $args[] = $patch['archived'] ? 1 : 0;
        }
        if ($sets !== []) {
            $args[] = $projectId;
            $args[] = $teamId;
            $up = Db::conn()->prepare('UPDATE projects SET ' . implode(', ', $sets) . ' WHERE id = ? AND team_id = ?');
            $up->execute($args);
        }

        return self::projectById($teamId, $projectId);
    }

    public static function projectById(int $teamId, int $projectId): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM projects WHERE id = ? AND team_id = ?');
        $sel->execute([$projectId, $teamId]);
        $r = $sel->fetch();
        if (!$r) {
            throw new ApiError('プロジェクトが見つかりません', 404);
        }
        return [
            'id'       => (int) $r['id'],
            'name'     => $r['name'],
            'emoji'    => $r['emoji'],
            'color'    => $r['color'],
            'archived' => (int) $r['archived'] === 1,
        ];
    }

    private static function addProject(int $teamId, string $name, string $emoji, string $color, float $order): int
    {
        $ins = Db::conn()->prepare(
            'INSERT INTO projects (team_id, name, emoji, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([$teamId, $name, $emoji, $color, $order, Clock::now()]);
        return (int) Db::conn()->lastInsertId();
    }

    private static function freshCode(): string
    {
        $db = Db::conn();
        for ($try = 0; $try < 50; $try++) {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= self::CODE_CHARS[random_int(0, strlen(self::CODE_CHARS) - 1)];
            }
            $sel = $db->prepare('SELECT 1 FROM teams WHERE join_code = ?');
            $sel->execute([$code]);
            if (!$sel->fetchColumn()) {
                return $code;
            }
        }
        throw new ApiError('参加コードを作れませんでした。もう一度お試しください', 500);
    }

    /** 絵文字らしきものを1文字だけ受け取る（長い文字列を入れられないように）。 */
    private static function oneEmoji(string $s): string
    {
        $s = trim($s);
        return $s === '' ? '📁' : mb_substr($s, 0, 2);
    }

    private static function color(string $s): string
    {
        return preg_match('/\A#[0-9a-fA-F]{6}\z/', $s) ? strtolower($s) : '#6366f1';
    }
}

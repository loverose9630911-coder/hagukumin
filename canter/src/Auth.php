<?php
/**
 * ログインまわり。
 *
 * パスワードは password_hash() で保存し、生の文字列はどこにも残さない。
 * ログイン状態は推測できない64桁のトークンを HttpOnly の Cookie に入れて持ち回る。
 */

declare(strict_types=1);

namespace Canter;

use RuntimeException;

final class Auth
{
    public const COOKIE = 'canter_session';

    /** アバターの色。登録順に配っていく。 */
    private const COLORS = [
        '#f0508c', '#7c5cff', '#00b8a9', '#ff8a3d', '#2f80ed',
        '#e0348b', '#5b8def', '#f2b705', '#12b886', '#8e44ad',
    ];

    public static function register(string $login, string $name, string $password): array
    {
        $login = trim($login);
        $name  = trim($name) !== '' ? trim($name) : $login;

        if (!preg_match('/\A[A-Za-z0-9_.-]{2,32}\z/', $login)) {
            throw new ApiError('ログインIDは半角英数字・記号(_ . -)の2〜32文字にしてください', 422);
        }
        if (mb_strlen($password) < 6) {
            throw new ApiError('パスワードは6文字以上にしてください', 422);
        }
        if (mb_strlen($name) > 32) {
            throw new ApiError('表示名は32文字までです', 422);
        }

        $db    = Db::conn();
        $taken = $db->prepare('SELECT 1 FROM users WHERE login = ?');
        $taken->execute([$login]);
        if ($taken->fetchColumn()) {
            throw new ApiError('そのログインIDは既に使われています', 409);
        }

        $count = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $ins   = $db->prepare(
            'INSERT INTO users (login, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $login,
            $name,
            password_hash($password, PASSWORD_DEFAULT),
            self::COLORS[$count % count(self::COLORS)],
            Clock::now(),
        ]);

        return self::user((int) $db->lastInsertId());
    }

    public static function login(string $login, string $password): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM users WHERE login = ?');
        $sel->execute([trim($login)]);
        $row = $sel->fetch();

        // ID が無いときも password_verify を通して、応答の速さで存在を悟られないようにする。
        $hash = $row['password_hash'] ?? '$2y$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
        if (!password_verify($password, $hash) || !$row) {
            throw new ApiError('ログインIDかパスワードが違います', 401);
        }

        return self::publicUser($row);
    }

    public static function startSession(int $userId): string
    {
        $token = bin2hex(random_bytes(32));
        $ins   = Db::conn()->prepare('INSERT INTO sessions (token, user_id, created_at, seen_at) VALUES (?, ?, ?, ?)');
        $ins->execute([$token, $userId, Clock::now(), Clock::now()]);

        self::cookie($token, time() + 60 * 60 * 24 * 30);

        return $token;
    }

    public static function endSession(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if ($token !== '') {
            $del = Db::conn()->prepare('DELETE FROM sessions WHERE token = ?');
            $del->execute([$token]);
        }
        self::cookie('', time() - 3600);
    }

    /** ログイン中のユーザー。していなければ null。 */
    public static function current(): ?array
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if ($token === '' || !preg_match('/\A[0-9a-f]{64}\z/', $token)) {
            return null;
        }

        $db  = Db::conn();
        $sel = $db->prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?');
        $sel->execute([$token]);
        $row = $sel->fetch();
        if (!$row) {
            return null;
        }

        $touch = $db->prepare('UPDATE sessions SET seen_at = ? WHERE token = ?');
        $touch->execute([Clock::now(), $token]);

        return self::publicUser($row);
    }

    public static function require(): array
    {
        $user = self::current();
        if ($user === null) {
            throw new ApiError('ログインしてください', 401);
        }
        return $user;
    }

    public static function user(int $id): array
    {
        $sel = Db::conn()->prepare('SELECT * FROM users WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row) {
            throw new RuntimeException("user {$id} not found");
        }
        return self::publicUser($row);
    }

    /** パスワードハッシュを外に出さないための詰め替え。 */
    public static function publicUser(array $row): array
    {
        return [
            'id'    => (int) $row['id'],
            'login' => $row['login'],
            'name'  => $row['name'],
            'color' => $row['color'],
        ];
    }

    private static function cookie(string $value, int $expires): void
    {
        if (headers_sent()) {
            return; // テストやコマンドラインから呼ばれたとき
        }
        setcookie(self::COOKIE, $value, [
            'expires'  => $expires,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure'   => self::isHttps(),
        ]);
    }

    private static function isHttps(): bool
    {
        return ($_SERVER['HTTPS'] ?? '') !== ''
            || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }
}

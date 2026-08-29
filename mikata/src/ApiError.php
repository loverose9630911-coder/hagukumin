<?php
/**
 * 「利用者に見せてよいエラー」。これ以外の例外は 500 として握りつぶす。
 */

declare(strict_types=1);

namespace Mikata;

use RuntimeException;

final class ApiError extends RuntimeException
{
    public function __construct(string $message, private int $status = 400)
    {
        parent::__construct($message);
    }

    public function status(): int
    {
        return $this->status;
    }
}

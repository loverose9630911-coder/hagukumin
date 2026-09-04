<?php
/**
 * 画面にそのまま出してよいエラー。
 *
 * これ以外の例外（プログラムの誤りなど）は中身を隠して 500 で返す。
 */

declare(strict_types=1);

namespace Canter;

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
